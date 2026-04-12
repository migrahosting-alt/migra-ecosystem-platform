<?php
/**
 * Plugin Name: MigraStacks Security
 * Plugin URI: https://migrateck.com
 * Description: Enterprise-grade hardening, lockout controls, and security operations for MigraStacks deployments.
 * Version: 2.0.0
 * Author: MigraStacks
 * Author URI: https://migrateck.com
 * License: GPL2+
 * Text Domain: migrastacks-security
 */

if (! defined('ABSPATH')) {
    exit;
}

final class MigraStacks_Security_Plugin
{
    private const OPTION_KEY = 'migrastacks_security_settings';
    private const LOCKOUT_OPTION_KEY = 'migrastacks_security_lockouts';
    private const TRANSIENT_PREFIX = 'migrastacks_security_attempt_';

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_admin_page']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('admin_post_migrastacks_security_clear_lockouts', [self::class, 'handle_clear_lockouts']);

        add_filter('plugin_action_links_' . plugin_basename(__FILE__), [self::class, 'settings_link']);
        add_filter('xmlrpc_enabled', [self::class, 'xmlrpc_enabled']);
        add_filter('xmlrpc_methods', [self::class, 'xmlrpc_methods']);
        add_filter('rest_endpoints', [self::class, 'block_rest_user_endpoints']);
        add_filter('wp_sitemaps_add_provider', [self::class, 'disable_user_sitemap_provider'], 10, 2);

        remove_action('wp_head', 'wp_generator');
        add_action('send_headers', [self::class, 'send_security_headers']);
        add_action('wp_login_failed', [self::class, 'handle_login_failed']);
        add_filter('authenticate', [self::class, 'check_login_lockout'], 30, 3);
        add_action('wp_login', [self::class, 'clear_login_attempts'], 10, 2);
        add_action('template_redirect', [self::class, 'prevent_author_enumeration']);

        if (defined('WP_CLI') && WP_CLI) {
            self::register_cli_commands();
        }
    }

    public static function activate(): void
    {
        $settings = get_option(self::OPTION_KEY, []);
        if (! is_array($settings)) {
            $settings = [];
        }
        update_option(self::OPTION_KEY, wp_parse_args($settings, self::defaults()));

        if (null === get_option(self::LOCKOUT_OPTION_KEY, null)) {
            add_option(self::LOCKOUT_OPTION_KEY, [], '', 'no');
        }
    }

    public static function register_admin_page(): void
    {
        add_options_page(
            'MigraStacks Security',
            'MigraStacks Security',
            'manage_options',
            'migrastacks-security',
            [self::class, 'render_settings_page']
        );
    }

    public static function register_settings(): void
    {
        register_setting('migrastacks_security', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => [self::class, 'sanitize_settings'],
            'default' => self::defaults(),
        ]);
    }

    public static function sanitize_settings(array $input): array
    {
        $max_attempts = isset($input['max_attempts']) ? (int) $input['max_attempts'] : 5;
        $max_attempts = max(3, min(20, $max_attempts));

        $lockout_minutes = isset($input['lockout_minutes']) ? (int) $input['lockout_minutes'] : 15;
        $lockout_minutes = max(1, min(1440, $lockout_minutes));

        return [
            'security_headers' => ! empty($input['security_headers']) ? '1' : '0',
            'disable_xmlrpc' => ! empty($input['disable_xmlrpc']) ? '1' : '0',
            'block_author_enumeration' => ! empty($input['block_author_enumeration']) ? '1' : '0',
            'block_rest_user_endpoints' => ! empty($input['block_rest_user_endpoints']) ? '1' : '0',
            'max_attempts' => (string) $max_attempts,
            'lockout_minutes' => (string) $lockout_minutes,
        ];
    }

    public static function settings_link(array $links): array
    {
        $links[] = '<a href="' . esc_url(admin_url('options-general.php?page=migrastacks-security')) . '">Settings</a>';
        return $links;
    }

    public static function xmlrpc_enabled(bool $enabled): bool
    {
        if (self::is_enabled('disable_xmlrpc')) {
            return false;
        }
        return $enabled;
    }

    public static function xmlrpc_methods(array $methods): array
    {
        if (! self::is_enabled('disable_xmlrpc')) {
            return $methods;
        }

        unset($methods['pingback.ping']);
        unset($methods['pingback.extensions.getPingbacks']);
        return $methods;
    }

    public static function send_security_headers(): void
    {
        if (! self::is_enabled('security_headers')) {
            return;
        }

        if (headers_sent()) {
            return;
        }

        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: SAMEORIGIN');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
        header('Cross-Origin-Opener-Policy: same-origin');

        $is_https = (wp_parse_url(home_url(), PHP_URL_SCHEME) === 'https');
        if ($is_https) {
            $hsts = apply_filters('migrastacks_security_hsts', 'max-age=31536000');
            header('Strict-Transport-Security: ' . sanitize_text_field((string) $hsts));
        }
    }

    public static function handle_login_failed(string $username): void
    {
        $username = self::normalize_username($username);
        $entry = self::get_attempt_entry($username);
        $entry['count'] = (int) $entry['count'] + 1;
        $entry['last'] = time();

        if ($entry['count'] >= self::max_attempts()) {
            $entry['locked_until'] = time() + self::lockout_seconds();
            $entry['count'] = self::max_attempts();
            self::record_lockout($username, (int) $entry['locked_until'], (int) $entry['count']);
            self::audit('security.login_lockout', [
                'username' => $username,
                'ip' => self::client_ip(),
                'locked_until' => gmdate('c', (int) $entry['locked_until']),
            ], 'warning');
        }

        set_transient(self::attempt_key($username), $entry, max(self::lockout_seconds() * 2, HOUR_IN_SECONDS));
    }

    public static function check_login_lockout($user, string $username, string $password)
    {
        unset($password);

        if ($user instanceof WP_User || (is_object($user) && isset($user->ID))) {
            return $user;
        }

        $username = self::normalize_username($username);
        $entry = self::get_attempt_entry($username);
        $locked_until = (int) ($entry['locked_until'] ?? 0);

        if ($locked_until > time()) {
            $minutes = max(1, (int) ceil(($locked_until - time()) / 60));
            return new WP_Error(
                'migrastacks_lockout',
                sprintf('Too many failed login attempts. Try again in %d minute(s).', $minutes)
            );
        }

        return $user;
    }

    public static function clear_login_attempts(string $user_login, WP_User $user): void
    {
        unset($user);
        $username = self::normalize_username($user_login);
        delete_transient(self::attempt_key($username));
        self::clear_lockouts(static function (array $lockout) use ($username): bool {
            return ($lockout['username'] ?? '') === $username;
        });
    }

    public static function prevent_author_enumeration(): void
    {
        if (! self::is_enabled('block_author_enumeration')) {
            return;
        }

        if (is_admin()) {
            return;
        }

        if (isset($_GET['author']) && ! current_user_can('list_users')) {
            self::audit('security.author_enum_blocked', ['ip' => self::client_ip()], 'notice');
            wp_safe_redirect(home_url('/'));
            exit;
        }
    }

    public static function block_rest_user_endpoints(array $endpoints): array
    {
        if (! self::is_enabled('block_rest_user_endpoints')) {
            return $endpoints;
        }

        if (is_user_logged_in()) {
            return $endpoints;
        }

        unset($endpoints['/wp/v2/users']);
        unset($endpoints['/wp/v2/users/(?P<id>[\\d]+)']);
        return $endpoints;
    }

    public static function disable_user_sitemap_provider($provider, string $name)
    {
        if (self::is_enabled('block_rest_user_endpoints') && $name === 'users' && ! is_user_logged_in()) {
            return false;
        }

        return $provider;
    }

    public static function render_settings_page(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        $settings = self::settings();
        $lockouts = self::active_lockouts();

        if (isset($_GET['lockouts_cleared']) && $_GET['lockouts_cleared'] === '1') {
            echo '<div class="notice notice-success is-dismissible"><p>Lockout registry cleared.</p></div>';
        }
        ?>
        <div class="wrap">
            <h1>MigraStacks Security</h1>

            <form method="post" action="options.php">
                <?php settings_fields('migrastacks_security'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">Security Headers</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[security_headers]"
                                    value="1"
                                    <?php checked($settings['security_headers'], '1'); ?>
                                />
                                Send application security headers
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">XML-RPC</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[disable_xmlrpc]"
                                    value="1"
                                    <?php checked($settings['disable_xmlrpc'], '1'); ?>
                                />
                                Disable XML-RPC endpoints
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">User Enumeration</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[block_author_enumeration]"
                                    value="1"
                                    <?php checked($settings['block_author_enumeration'], '1'); ?>
                                />
                                Block `?author=` enumeration on public pages
                            </label>
                            <p>
                                <label>
                                    <input
                                        type="checkbox"
                                        name="<?php echo esc_attr(self::OPTION_KEY); ?>[block_rest_user_endpoints]"
                                        value="1"
                                        <?php checked($settings['block_rest_user_endpoints'], '1'); ?>
                                    />
                                    Hide public REST user endpoints and user sitemaps
                                </label>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Login Lockout Policy</th>
                        <td>
                            <p>
                                <label for="migrastacks_max_attempts">Max Attempts</label>
                                <input
                                    type="number"
                                    min="3"
                                    max="20"
                                    id="migrastacks_max_attempts"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[max_attempts]"
                                    value="<?php echo esc_attr($settings['max_attempts']); ?>"
                                />
                            </p>
                            <p>
                                <label for="migrastacks_lockout_minutes">Lockout Minutes</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="1440"
                                    id="migrastacks_lockout_minutes"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[lockout_minutes]"
                                    value="<?php echo esc_attr($settings['lockout_minutes']); ?>"
                                />
                            </p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save Security Settings'); ?>
            </form>

            <hr />

            <h2>Active Lockouts</h2>
            <?php if (empty($lockouts)): ?>
                <p>No active lockouts.</p>
            <?php else: ?>
                <table class="widefat striped">
                    <thead>
                        <tr>
                            <th>Key</th>
                            <th>Username</th>
                            <th>IP</th>
                            <th>Attempts</th>
                            <th>Locked Until (UTC)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($lockouts as $key => $lockout): ?>
                            <tr>
                                <td><code><?php echo esc_html((string) $key); ?></code></td>
                                <td><?php echo esc_html((string) ($lockout['username'] ?? 'unknown')); ?></td>
                                <td><?php echo esc_html((string) ($lockout['ip'] ?? 'unknown')); ?></td>
                                <td><?php echo esc_html((string) ($lockout['attempts'] ?? 0)); ?></td>
                                <td><?php echo esc_html(gmdate('c', (int) ($lockout['locked_until'] ?? 0))); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="migrastacks_security_clear_lockouts" />
                <?php wp_nonce_field('migrastacks_security_clear_lockouts'); ?>
                <?php submit_button('Clear All Lockouts', 'delete', 'submit', false); ?>
            </form>
        </div>
        <?php
    }

    public static function handle_clear_lockouts(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized request.');
        }

        check_admin_referer('migrastacks_security_clear_lockouts');
        $cleared = self::clear_lockouts();
        self::audit('security.lockouts_cleared', [
            'user' => wp_get_current_user()->user_login,
            'count' => $cleared,
        ], 'warning');

        wp_safe_redirect(
            add_query_arg(
                ['page' => 'migrastacks-security', 'lockouts_cleared' => '1'],
                admin_url('options-general.php')
            )
        );
        exit;
    }

    private static function settings(): array
    {
        $settings = get_option(self::OPTION_KEY, []);
        if (! is_array($settings)) {
            $settings = [];
        }
        return wp_parse_args($settings, self::defaults());
    }

    private static function defaults(): array
    {
        return [
            'security_headers' => '1',
            'disable_xmlrpc' => '1',
            'block_author_enumeration' => '1',
            'block_rest_user_endpoints' => '1',
            'max_attempts' => '5',
            'lockout_minutes' => '15',
        ];
    }

    private static function is_enabled(string $key): bool
    {
        $settings = self::settings();
        return ($settings[$key] ?? '0') === '1';
    }

    private static function lockout_seconds(): int
    {
        $minutes = (int) (self::settings()['lockout_minutes'] ?? 15);
        $minutes = max(1, min(1440, $minutes));
        return $minutes * MINUTE_IN_SECONDS;
    }

    private static function max_attempts(): int
    {
        $attempts = (int) (self::settings()['max_attempts'] ?? 5);
        return max(3, min(20, $attempts));
    }

    private static function normalize_username(string $username): string
    {
        $username = sanitize_user($username, true);
        return $username !== '' ? strtolower($username) : 'unknown';
    }

    private static function attempt_key(string $username): string
    {
        return self::TRANSIENT_PREFIX . md5(self::client_ip() . '|' . $username);
    }

    private static function get_attempt_entry(string $username): array
    {
        $entry = get_transient(self::attempt_key($username));
        if (! is_array($entry)) {
            return [
                'count' => 0,
                'last' => 0,
                'locked_until' => 0,
            ];
        }

        return [
            'count' => (int) ($entry['count'] ?? 0),
            'last' => (int) ($entry['last'] ?? 0),
            'locked_until' => (int) ($entry['locked_until'] ?? 0),
        ];
    }

    private static function client_ip(): string
    {
        $proxy = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if (is_string($proxy) && $proxy !== '') {
            $candidates = explode(',', $proxy);
            foreach ($candidates as $candidate) {
                $candidate = trim($candidate);
                if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                    return $candidate;
                }
            }
        }

        $remote = $_SERVER['REMOTE_ADDR'] ?? '';
        if (is_string($remote) && filter_var($remote, FILTER_VALIDATE_IP)) {
            return $remote;
        }

        return 'unknown';
    }

    private static function lockout_registry(): array
    {
        $registry = get_option(self::LOCKOUT_OPTION_KEY, []);
        if (! is_array($registry)) {
            $registry = [];
        }

        return self::purge_expired_lockouts($registry);
    }

    private static function purge_expired_lockouts(array $registry): array
    {
        $changed = false;
        $now = time();

        foreach ($registry as $key => $lockout) {
            $locked_until = (int) ($lockout['locked_until'] ?? 0);
            if ($locked_until <= $now) {
                unset($registry[$key]);
                delete_transient((string) $key);
                $changed = true;
            }
        }

        if ($changed) {
            update_option(self::LOCKOUT_OPTION_KEY, $registry);
        }

        return $registry;
    }

    private static function record_lockout(string $username, int $locked_until, int $attempts): void
    {
        $key = self::attempt_key($username);
        $registry = self::lockout_registry();
        $registry[$key] = [
            'username' => $username,
            'ip' => self::client_ip(),
            'attempts' => $attempts,
            'locked_until' => $locked_until,
            'updated_at' => time(),
        ];

        update_option(self::LOCKOUT_OPTION_KEY, $registry);
    }

    private static function clear_lockouts($predicate = null): int
    {
        $registry = self::lockout_registry();
        if (empty($registry)) {
            return 0;
        }

        $remaining = [];
        $cleared = 0;

        foreach ($registry as $key => $lockout) {
            $should_clear = true;
            if (is_callable($predicate)) {
                $should_clear = (bool) call_user_func($predicate, $lockout);
            }

            if ($should_clear) {
                delete_transient((string) $key);
                $cleared++;
                continue;
            }

            $remaining[$key] = $lockout;
        }

        update_option(self::LOCKOUT_OPTION_KEY, $remaining);
        return $cleared;
    }

    private static function active_lockouts(): array
    {
        $registry = self::lockout_registry();
        uasort($registry, static function (array $a, array $b): int {
            return (int) ($b['locked_until'] ?? 0) <=> (int) ($a['locked_until'] ?? 0);
        });
        return $registry;
    }

    private static function audit(string $event, array $context, string $severity): void
    {
        if (function_exists('migrastacks_audit_event')) {
            migrastacks_audit_event($event, $context, $severity);
            return;
        }

        do_action('migrastacks_audit_event', $event, $context, $severity);
    }

    private static function register_cli_commands(): void
    {
        WP_CLI::add_command('migrastacks security lockouts', [self::class, 'cli_lockouts']);
        WP_CLI::add_command('migrastacks security unlock', [self::class, 'cli_unlock']);
    }

    public static function cli_lockouts(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);
        $lockouts = self::active_lockouts();
        if (empty($lockouts)) {
            WP_CLI::log('No active lockouts.');
            return;
        }

        $rows = [];
        foreach ($lockouts as $key => $lockout) {
            $rows[] = [
                'key' => $key,
                'username' => (string) ($lockout['username'] ?? 'unknown'),
                'ip' => (string) ($lockout['ip'] ?? 'unknown'),
                'attempts' => (string) ($lockout['attempts'] ?? 0),
                'locked_until' => gmdate('c', (int) ($lockout['locked_until'] ?? 0)),
            ];
        }

        \WP_CLI\Utils\format_items('table', $rows, ['key', 'username', 'ip', 'attempts', 'locked_until']);
    }

    public static function cli_unlock(array $args, array $assoc_args): void
    {
        unset($args);

        if (! empty($assoc_args['all'])) {
            $count = self::clear_lockouts();
            WP_CLI::success(sprintf('Cleared %d lockout(s).', $count));
            return;
        }

        if (! empty($assoc_args['username'])) {
            $username = self::normalize_username((string) $assoc_args['username']);
            $count = self::clear_lockouts(static function (array $lockout) use ($username): bool {
                return ($lockout['username'] ?? '') === $username;
            });
            WP_CLI::success(sprintf('Cleared %d lockout(s) for username "%s".', $count, $username));
            return;
        }

        if (! empty($assoc_args['ip'])) {
            $ip = sanitize_text_field((string) $assoc_args['ip']);
            $count = self::clear_lockouts(static function (array $lockout) use ($ip): bool {
                return ($lockout['ip'] ?? '') === $ip;
            });
            WP_CLI::success(sprintf('Cleared %d lockout(s) for IP "%s".', $count, $ip));
            return;
        }

        WP_CLI::error('Specify --all, --username=<value>, or --ip=<value>.');
    }
}

register_activation_hook(__FILE__, ['MigraStacks_Security_Plugin', 'activate']);
MigraStacks_Security_Plugin::init();
