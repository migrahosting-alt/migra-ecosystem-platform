<?php
/**
 * Plugin Name: MigraStacks Core
 * Plugin URI: https://migrateck.com
 * Description: Enterprise core policy, health checks, audit logging, and CLI controls for MigraStacks deployments.
 * Version: 2.0.0
 * Author: MigraStacks
 * Author URI: https://migrateck.com
 * License: GPL2+
 * Text Domain: migrastacks-core
 */

if (! defined('ABSPATH')) {
    exit;
}

if (! function_exists('migrastacks_audit_event')) {
    function migrastacks_audit_event(string $event, array $context = [], string $severity = 'info'): void
    {
        do_action('migrastacks_audit_event', $event, $context, $severity);
    }
}

final class MigraStacks_Core_Plugin
{
    private const OPTION_KEY = 'migrastacks_core_settings';
    private const AUDIT_OPTION_KEY = 'migrastacks_core_audit_log';
    private const DEFAULT_MAX_AUDIT_ITEMS = 500;
    private const HARD_MAX_AUDIT_ITEMS = 5000;
    private const DEFAULT_AUDIT_RETENTION_DAYS = 30;

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_admin_page']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('admin_post_migrastacks_core_clear_audit', [self::class, 'handle_clear_audit']);
        add_action('migrastacks_audit_event', [self::class, 'capture_audit_event'], 10, 3);

        add_filter('plugin_action_links_' . plugin_basename(__FILE__), [self::class, 'settings_link']);
        add_filter('site_status_tests', [self::class, 'site_health_tests']);

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

        if (null === get_option(self::AUDIT_OPTION_KEY, null)) {
            add_option(self::AUDIT_OPTION_KEY, [], '', 'no');
        }

        migrastacks_audit_event('core.plugin_activated', ['version' => '2.0.0'], 'notice');
    }

    public static function register_admin_page(): void
    {
        add_options_page(
            'MigraStacks Core',
            'MigraStacks Core',
            'manage_options',
            'migrastacks-core',
            [self::class, 'render_settings_page']
        );
    }

    public static function register_settings(): void
    {
        register_setting('migrastacks_core', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => [self::class, 'sanitize_settings'],
            'default' => self::defaults(),
        ]);
    }

    public static function sanitize_settings(array $input): array
    {
        $defaults = self::defaults();

        $max_items = isset($input['max_audit_items']) ? (int) $input['max_audit_items'] : self::DEFAULT_MAX_AUDIT_ITEMS;
        $max_items = max(50, min(self::HARD_MAX_AUDIT_ITEMS, $max_items));

        $retention_days = isset($input['audit_retention_days']) ? (int) $input['audit_retention_days'] : self::DEFAULT_AUDIT_RETENTION_DAYS;
        $retention_days = max(1, min(365, $retention_days));

        $environment = sanitize_text_field($input['environment'] ?? $defaults['environment']);
        $allowed_environments = ['production', 'staging', 'development'];
        if (! in_array($environment, $allowed_environments, true)) {
            $environment = $defaults['environment'];
        }

        return [
            'enable_health_checks' => ! empty($input['enable_health_checks']) ? '1' : '0',
            'brand_name' => sanitize_text_field($input['brand_name'] ?? $defaults['brand_name']),
            'audit_enabled' => ! empty($input['audit_enabled']) ? '1' : '0',
            'max_audit_items' => (string) $max_items,
            'audit_retention_days' => (string) $retention_days,
            'environment' => $environment,
        ];
    }

    public static function settings_link(array $links): array
    {
        $links[] = '<a href="' . esc_url(admin_url('options-general.php?page=migrastacks-core')) . '">Settings</a>';
        return $links;
    }

    public static function site_health_tests(array $tests): array
    {
        $settings = self::settings();
        if (($settings['enable_health_checks'] ?? '1') !== '1') {
            return $tests;
        }

        $tests['direct']['migrastacks_permalink'] = [
            'label' => 'MigraStacks: Pretty permalinks',
            'test' => [self::class, 'run_permalink_health_test'],
        ];

        $tests['direct']['migrastacks_https'] = [
            'label' => 'MigraStacks: HTTPS configuration',
            'test' => [self::class, 'run_https_health_test'],
        ];

        $tests['direct']['migrastacks_debug_mode'] = [
            'label' => 'MigraStacks: Debug mode posture',
            'test' => [self::class, 'run_debug_mode_health_test'],
        ];

        $tests['direct']['migrastacks_cron'] = [
            'label' => 'MigraStacks: WP-Cron scheduling',
            'test' => [self::class, 'run_cron_health_test'],
        ];

        $tests['direct']['migrastacks_object_cache'] = [
            'label' => 'MigraStacks: Object cache backend',
            'test' => [self::class, 'run_object_cache_health_test'],
        ];

        return $tests;
    }

    public static function run_permalink_health_test(): array
    {
        $using_pretty = get_option('permalink_structure') !== '';
        if ($using_pretty) {
            return self::health_result(
                'Pretty permalinks are enabled',
                'good',
                'Pretty permalinks are enabled, which is recommended for enterprise SEO posture.',
                'migrastacks_permalink'
            );
        }

        return self::health_result(
            'Pretty permalinks are disabled',
            'recommended',
            'Enable pretty permalinks for cleaner URLs and stronger SEO defaults.',
            'migrastacks_permalink',
            '<p><a class="button button-primary" href="' . esc_url(admin_url('options-permalink.php')) . '">Open Permalink Settings</a></p>'
        );
    }

    public static function run_https_health_test(): array
    {
        $home_scheme = wp_parse_url(home_url(), PHP_URL_SCHEME);
        $site_scheme = wp_parse_url(site_url(), PHP_URL_SCHEME);
        $https_ready = ($home_scheme === 'https' && $site_scheme === 'https');

        if ($https_ready) {
            return self::health_result(
                'HTTPS is configured for site and home URL',
                'good',
                'WordPress URLs use HTTPS.',
                'migrastacks_https'
            );
        }

        return self::health_result(
            'HTTPS is not fully configured',
            'critical',
            'Set both WordPress Address and Site Address to HTTPS.',
            'migrastacks_https',
            '<p><a class="button button-primary" href="' . esc_url(admin_url('options-general.php')) . '">Open General Settings</a></p>'
        );
    }

    public static function run_debug_mode_health_test(): array
    {
        $debug_on = defined('WP_DEBUG') && WP_DEBUG;
        $environment = function_exists('wp_get_environment_type')
            ? wp_get_environment_type()
            : (self::settings()['environment'] ?? 'production');

        if (! $debug_on) {
            return self::health_result(
                'WP_DEBUG is disabled',
                'good',
                'Debug mode is disabled, which is recommended for production.',
                'migrastacks_debug_mode'
            );
        }

        $status = $environment === 'production' ? 'critical' : 'recommended';
        return self::health_result(
            'WP_DEBUG is enabled',
            $status,
            sprintf('WP_DEBUG is enabled while environment is "%s".', esc_html($environment)),
            'migrastacks_debug_mode'
        );
    }

    public static function run_cron_health_test(): array
    {
        $cron_disabled = defined('DISABLE_WP_CRON') && DISABLE_WP_CRON;
        $next_version_check = wp_next_scheduled('wp_version_check');

        if (! $cron_disabled && $next_version_check) {
            return self::health_result(
                'WP-Cron is scheduled',
                'good',
                'WP-Cron is active and scheduled tasks are present.',
                'migrastacks_cron'
            );
        }

        if ($cron_disabled) {
            return self::health_result(
                'DISABLE_WP_CRON is enabled',
                'recommended',
                'Ensure a real server cron calls wp-cron.php regularly.',
                'migrastacks_cron'
            );
        }

        return self::health_result(
            'No WP-Cron tasks detected',
            'recommended',
            'No scheduled tasks were found. Verify cron setup and traffic flow.',
            'migrastacks_cron'
        );
    }

    public static function run_object_cache_health_test(): array
    {
        if (wp_using_ext_object_cache()) {
            return self::health_result(
                'Persistent object cache detected',
                'good',
                'A persistent object cache backend is enabled.',
                'migrastacks_object_cache'
            );
        }

        return self::health_result(
            'No persistent object cache detected',
            'recommended',
            'Redis or Memcached is recommended for enterprise workloads.',
            'migrastacks_object_cache'
        );
    }

    public static function render_settings_page(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        $settings = self::settings();
        $logs = self::get_audit_log();

        if (isset($_GET['audit_cleared']) && $_GET['audit_cleared'] === '1') {
            echo '<div class="notice notice-success is-dismissible"><p>Audit log cleared.</p></div>';
        }
        ?>
        <div class="wrap">
            <h1><?php echo esc_html($settings['brand_name']); ?> Core</h1>

            <form method="post" action="options.php">
                <?php settings_fields('migrastacks_core'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="migrastacks_brand_name">Brand Name</label></th>
                        <td>
                            <input
                                type="text"
                                id="migrastacks_brand_name"
                                name="<?php echo esc_attr(self::OPTION_KEY); ?>[brand_name]"
                                value="<?php echo esc_attr($settings['brand_name']); ?>"
                                class="regular-text"
                            />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Environment</th>
                        <td>
                            <select name="<?php echo esc_attr(self::OPTION_KEY); ?>[environment]">
                                <?php foreach (['production', 'staging', 'development'] as $env): ?>
                                    <option value="<?php echo esc_attr($env); ?>" <?php selected($settings['environment'], $env); ?>>
                                        <?php echo esc_html(ucfirst($env)); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Health Checks</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[enable_health_checks]"
                                    value="1"
                                    <?php checked($settings['enable_health_checks'], '1'); ?>
                                />
                                Enable MigraStacks Site Health test suite
                            </label>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Audit Logging</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[audit_enabled]"
                                    value="1"
                                    <?php checked($settings['audit_enabled'], '1'); ?>
                                />
                                Enable rolling audit log
                            </label>
                            <p>
                                <label for="migrastacks_max_audit_items">Max Entries</label>
                                <input
                                    type="number"
                                    min="50"
                                    max="<?php echo esc_attr((string) self::HARD_MAX_AUDIT_ITEMS); ?>"
                                    id="migrastacks_max_audit_items"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[max_audit_items]"
                                    value="<?php echo esc_attr($settings['max_audit_items']); ?>"
                                />
                            </p>
                            <p>
                                <label for="migrastacks_audit_retention_days">Retention Days</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="365"
                                    id="migrastacks_audit_retention_days"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[audit_retention_days]"
                                    value="<?php echo esc_attr($settings['audit_retention_days']); ?>"
                                />
                            </p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save Core Settings'); ?>
            </form>

            <hr />

            <h2>Recent Audit Events</h2>
            <p>Showing latest <?php echo esc_html((string) min(25, count($logs))); ?> events.</p>
            <?php self::render_audit_table($logs, 25); ?>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="migrastacks_core_clear_audit" />
                <?php wp_nonce_field('migrastacks_core_clear_audit'); ?>
                <?php submit_button('Clear Audit Log', 'delete', 'submit', false); ?>
            </form>
        </div>
        <?php
    }

    public static function handle_clear_audit(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized request.');
        }

        check_admin_referer('migrastacks_core_clear_audit');
        update_option(self::AUDIT_OPTION_KEY, []);

        migrastacks_audit_event('core.audit_log_cleared', [
            'user' => wp_get_current_user()->user_login,
        ], 'warning');

        wp_safe_redirect(
            add_query_arg(
                ['page' => 'migrastacks-core', 'audit_cleared' => '1'],
                admin_url('options-general.php')
            )
        );
        exit;
    }

    public static function capture_audit_event($event, $context = [], $severity = 'info'): void
    {
        $settings = self::settings();
        if (($settings['audit_enabled'] ?? '1') !== '1') {
            return;
        }

        if (! is_string($event) || $event === '') {
            return;
        }

        $entry = [
            'timestamp' => gmdate('c'),
            'event' => sanitize_text_field($event),
            'severity' => self::sanitize_severity(is_string($severity) ? $severity : 'info'),
            'context' => self::sanitize_context($context),
        ];

        $log = self::get_audit_log();
        $log[] = $entry;
        $log = self::prune_audit_log($log, $settings);

        update_option(self::AUDIT_OPTION_KEY, $log);
    }

    private static function sanitize_severity(string $severity): string
    {
        $allowed = ['info', 'notice', 'warning', 'error', 'critical'];
        $severity = strtolower(sanitize_text_field($severity));
        if (! in_array($severity, $allowed, true)) {
            return 'info';
        }
        return $severity;
    }

    private static function sanitize_context($value, int $depth = 0)
    {
        if ($depth > 3) {
            return '[depth-limit]';
        }

        if (is_array($value)) {
            $sanitized = [];
            foreach ($value as $key => $item) {
                $sanitized_key = is_string($key) ? sanitize_key($key) : (string) $key;
                $sanitized[$sanitized_key] = self::sanitize_context($item, $depth + 1);
            }
            return $sanitized;
        }

        if (is_object($value)) {
            if (method_exists($value, '__toString')) {
                return sanitize_text_field((string) $value);
            }
            return 'object:' . get_class($value);
        }

        if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
            return $value;
        }

        return sanitize_text_field((string) $value);
    }

    private static function prune_audit_log(array $log, array $settings): array
    {
        $retention_days = max(1, (int) ($settings['audit_retention_days'] ?? self::DEFAULT_AUDIT_RETENTION_DAYS));
        $cutoff = time() - ($retention_days * DAY_IN_SECONDS);
        $trimmed = [];

        foreach ($log as $entry) {
            if (! is_array($entry) || empty($entry['timestamp'])) {
                continue;
            }

            $ts = strtotime((string) $entry['timestamp']);
            if ($ts !== false && $ts < $cutoff) {
                continue;
            }

            $trimmed[] = $entry;
        }

        $max_items = max(50, min(self::HARD_MAX_AUDIT_ITEMS, (int) ($settings['max_audit_items'] ?? self::DEFAULT_MAX_AUDIT_ITEMS)));
        if (count($trimmed) > $max_items) {
            $trimmed = array_slice($trimmed, -1 * $max_items);
        }

        return $trimmed;
    }

    private static function render_audit_table(array $logs, int $limit): void
    {
        $display = array_slice(array_reverse($logs), 0, $limit);
        if (empty($display)) {
            echo '<p>No audit events logged yet.</p>';
            return;
        }

        echo '<table class="widefat striped"><thead><tr>';
        echo '<th>Timestamp (UTC)</th><th>Severity</th><th>Event</th><th>Context</th>';
        echo '</tr></thead><tbody>';

        foreach ($display as $entry) {
            $context_json = isset($entry['context']) ? wp_json_encode($entry['context']) : '{}';
            echo '<tr>';
            echo '<td>' . esc_html((string) ($entry['timestamp'] ?? '')) . '</td>';
            echo '<td>' . esc_html(strtoupper((string) ($entry['severity'] ?? 'INFO'))) . '</td>';
            echo '<td>' . esc_html((string) ($entry['event'] ?? '')) . '</td>';
            echo '<td><code>' . esc_html((string) $context_json) . '</code></td>';
            echo '</tr>';
        }

        echo '</tbody></table>';
    }

    private static function health_result(string $label, string $status, string $description, string $test, string $actions = ''): array
    {
        return [
            'label' => $label,
            'status' => $status,
            'badge' => ['label' => 'MigraStacks', 'color' => 'blue'],
            'description' => '<p>' . esc_html($description) . '</p>',
            'actions' => $actions,
            'test' => $test,
        ];
    }

    private static function get_audit_log(): array
    {
        $log = get_option(self::AUDIT_OPTION_KEY, []);
        return is_array($log) ? $log : [];
    }

    private static function defaults(): array
    {
        return [
            'enable_health_checks' => '1',
            'brand_name' => 'MigraStacks',
            'audit_enabled' => '1',
            'max_audit_items' => (string) self::DEFAULT_MAX_AUDIT_ITEMS,
            'audit_retention_days' => (string) self::DEFAULT_AUDIT_RETENTION_DAYS,
            'environment' => 'production',
        ];
    }

    private static function settings(): array
    {
        $settings = get_option(self::OPTION_KEY, []);
        if (! is_array($settings)) {
            $settings = [];
        }

        return wp_parse_args($settings, self::defaults());
    }

    private static function register_cli_commands(): void
    {
        WP_CLI::add_command('migrastacks status', [self::class, 'cli_status']);
        WP_CLI::add_command('migrastacks audit list', [self::class, 'cli_audit_list']);
        WP_CLI::add_command('migrastacks audit clear', [self::class, 'cli_audit_clear']);
    }

    public static function cli_status(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);

        if (! function_exists('is_plugin_active')) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }

        $plugins = [
            'migrastacks-core/migrastacks-core.php',
            'migrastacks-security/migrastacks-security.php',
            'migrastacks-performance/migrastacks-performance.php',
            'migrastacks-deliverability/migrastacks-deliverability.php',
        ];

        $plugin_rows = [];
        foreach ($plugins as $plugin_file) {
            $active = is_plugin_active($plugin_file)
                || (is_multisite() && function_exists('is_plugin_active_for_network') && is_plugin_active_for_network($plugin_file));
            $plugin_rows[] = [
                'plugin' => $plugin_file,
                'status' => $active ? 'active' : 'inactive',
            ];
        }

        WP_CLI::log('MigraStacks plugin status:');
        \WP_CLI\Utils\format_items('table', $plugin_rows, ['plugin', 'status']);

        $checks = [
            [
                'check' => 'HTTPS URLs',
                'status' => (wp_parse_url(home_url(), PHP_URL_SCHEME) === 'https' && wp_parse_url(site_url(), PHP_URL_SCHEME) === 'https') ? 'pass' : 'fail',
                'details' => home_url() . ' | ' . site_url(),
            ],
            [
                'check' => 'Pretty permalinks',
                'status' => get_option('permalink_structure') !== '' ? 'pass' : 'warn',
                'details' => get_option('permalink_structure') ?: '(plain)',
            ],
            [
                'check' => 'WP_DEBUG',
                'status' => (defined('WP_DEBUG') && WP_DEBUG) ? 'warn' : 'pass',
                'details' => (defined('WP_DEBUG') && WP_DEBUG) ? 'enabled' : 'disabled',
            ],
            [
                'check' => 'Object cache',
                'status' => wp_using_ext_object_cache() ? 'pass' : 'warn',
                'details' => wp_using_ext_object_cache() ? 'persistent cache enabled' : 'not detected',
            ],
        ];

        WP_CLI::log('');
        WP_CLI::log('Platform checks:');
        \WP_CLI\Utils\format_items('table', $checks, ['check', 'status', 'details']);
    }

    public static function cli_audit_list(array $args, array $assoc_args): void
    {
        unset($args);

        $limit = isset($assoc_args['limit']) ? (int) $assoc_args['limit'] : 20;
        $limit = max(1, min(200, $limit));

        $logs = array_slice(array_reverse(self::get_audit_log()), 0, $limit);
        if (empty($logs)) {
            WP_CLI::warning('No audit events found.');
            return;
        }

        $rows = [];
        foreach ($logs as $entry) {
            $rows[] = [
                'timestamp' => (string) ($entry['timestamp'] ?? ''),
                'severity' => (string) ($entry['severity'] ?? 'info'),
                'event' => (string) ($entry['event'] ?? ''),
                'context' => wp_json_encode($entry['context'] ?? []),
            ];
        }

        \WP_CLI\Utils\format_items('table', $rows, ['timestamp', 'severity', 'event', 'context']);
    }

    public static function cli_audit_clear(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);
        update_option(self::AUDIT_OPTION_KEY, []);
        WP_CLI::success('Audit log cleared.');
    }
}

register_activation_hook(__FILE__, ['MigraStacks_Core_Plugin', 'activate']);
MigraStacks_Core_Plugin::init();
