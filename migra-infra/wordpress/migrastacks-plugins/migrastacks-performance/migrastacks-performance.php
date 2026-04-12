<?php
/**
 * Plugin Name: MigraStacks Performance
 * Plugin URI: https://migrateck.com
 * Description: Enterprise performance policy and maintenance operations for MigraStacks WordPress deployments.
 * Version: 2.0.0
 * Author: MigraStacks
 * Author URI: https://migrateck.com
 * License: GPL2+
 * Text Domain: migrastacks-performance
 */

if (! defined('ABSPATH')) {
    exit;
}

final class MigraStacks_Performance_Plugin
{
    private const OPTION_KEY = 'migrastacks_performance_settings';
    private const LAST_CLEANUP_OPTION = 'migrastacks_performance_last_cleanup_utc';
    private const CLEANUP_HOOK = 'migrastacks_performance_daily_cleanup';

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_admin_page']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('admin_post_migrastacks_performance_cleanup', [self::class, 'handle_manual_cleanup']);
        add_action('init', [self::class, 'configure_runtime_hooks'], 1);
        add_action(self::CLEANUP_HOOK, [self::class, 'run_cleanup']);

        add_filter('plugin_action_links_' . plugin_basename(__FILE__), [self::class, 'settings_link']);

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
        self::ensure_cleanup_schedule();
    }

    public static function deactivate(): void
    {
        self::clear_cleanup_schedule();
    }

    public static function register_admin_page(): void
    {
        add_options_page(
            'MigraStacks Performance',
            'MigraStacks Performance',
            'manage_options',
            'migrastacks-performance',
            [self::class, 'render_settings_page']
        );
    }

    public static function register_settings(): void
    {
        register_setting('migrastacks_performance', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => [self::class, 'sanitize_settings'],
            'default' => self::defaults(),
        ]);
    }

    public static function sanitize_settings(array $input): array
    {
        $heartbeat = isset($input['heartbeat_interval']) ? (int) $input['heartbeat_interval'] : 60;
        $heartbeat = max(15, min(120, $heartbeat));

        $revisions = isset($input['revisions_limit']) ? (int) $input['revisions_limit'] : 20;
        $revisions = max(0, min(100, $revisions));

        return [
            'disable_emojis' => ! empty($input['disable_emojis']) ? '1' : '0',
            'disable_jquery_migrate' => ! empty($input['disable_jquery_migrate']) ? '1' : '0',
            'strip_asset_version_query' => ! empty($input['strip_asset_version_query']) ? '1' : '0',
            'disable_embed_script' => ! empty($input['disable_embed_script']) ? '1' : '0',
            'enable_daily_transient_cleanup' => ! empty($input['enable_daily_transient_cleanup']) ? '1' : '0',
            'heartbeat_interval' => (string) $heartbeat,
            'revisions_limit' => (string) $revisions,
        ];
    }

    public static function settings_link(array $links): array
    {
        $links[] = '<a href="' . esc_url(admin_url('options-general.php?page=migrastacks-performance')) . '">Settings</a>';
        return $links;
    }

    public static function configure_runtime_hooks(): void
    {
        $settings = self::settings();

        if (($settings['disable_emojis'] ?? '1') === '1') {
            self::disable_emojis();
        }

        if (($settings['disable_jquery_migrate'] ?? '1') === '1') {
            add_action('wp_default_scripts', [self::class, 'dequeue_jquery_migrate']);
        }

        if (($settings['strip_asset_version_query'] ?? '1') === '1') {
            add_filter('script_loader_src', [self::class, 'strip_asset_version_query'], 15, 1);
            add_filter('style_loader_src', [self::class, 'strip_asset_version_query'], 15, 1);
        }

        if (($settings['disable_embed_script'] ?? '1') === '1') {
            add_action('wp_enqueue_scripts', [self::class, 'disable_embed_script']);
        }

        add_filter('heartbeat_settings', [self::class, 'heartbeat_interval']);

        if ((int) ($settings['revisions_limit'] ?? 20) > 0) {
            add_filter('wp_revisions_to_keep', [self::class, 'revisions_to_keep'], 10, 2);
        }

        if (($settings['enable_daily_transient_cleanup'] ?? '1') === '1') {
            self::ensure_cleanup_schedule();
        } else {
            self::clear_cleanup_schedule();
        }
    }

    public static function disable_emojis(): void
    {
        remove_action('wp_head', 'print_emoji_detection_script', 7);
        remove_action('admin_print_scripts', 'print_emoji_detection_script');
        remove_action('wp_print_styles', 'print_emoji_styles');
        remove_action('admin_print_styles', 'print_emoji_styles');
        remove_filter('the_content_feed', 'wp_staticize_emoji');
        remove_filter('comment_text_rss', 'wp_staticize_emoji');
        remove_filter('wp_mail', 'wp_staticize_emoji_for_email');
    }

    public static function dequeue_jquery_migrate(WP_Scripts $scripts): void
    {
        if (is_admin()) {
            return;
        }

        if (! isset($scripts->registered['jquery'])) {
            return;
        }

        $deps = $scripts->registered['jquery']->deps;
        $scripts->registered['jquery']->deps = array_diff($deps, ['jquery-migrate']);
    }

    public static function strip_asset_version_query(string $src): string
    {
        if (is_admin()) {
            return $src;
        }

        $asset_host = wp_parse_url($src, PHP_URL_HOST);
        $site_host = wp_parse_url(home_url(), PHP_URL_HOST);
        if (is_string($asset_host) && is_string($site_host) && $asset_host !== '' && $asset_host !== $site_host) {
            return $src;
        }

        return remove_query_arg('ver', $src);
    }

    public static function heartbeat_interval(array $settings): array
    {
        $target = (int) (self::settings()['heartbeat_interval'] ?? 60);
        $target = max(15, min(120, $target));
        $settings['interval'] = $target;
        return $settings;
    }

    public static function revisions_to_keep($num, $post)
    {
        unset($post);
        $limit = (int) (self::settings()['revisions_limit'] ?? 20);
        if ($limit <= 0) {
            return $num;
        }

        return $limit;
    }

    public static function disable_embed_script(): void
    {
        wp_dequeue_script('wp-embed');
    }

    public static function run_cleanup(): bool
    {
        if (function_exists('delete_expired_transients')) {
            delete_expired_transients();
        }

        update_option(self::LAST_CLEANUP_OPTION, gmdate('c'));
        self::audit('performance.transient_cleanup', ['timestamp' => gmdate('c')], 'notice');

        return true;
    }

    public static function handle_manual_cleanup(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized request.');
        }

        check_admin_referer('migrastacks_performance_cleanup');
        self::run_cleanup();

        wp_safe_redirect(
            add_query_arg(
                ['page' => 'migrastacks-performance', 'cleanup' => '1'],
                admin_url('options-general.php')
            )
        );
        exit;
    }

    public static function render_settings_page(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        $settings = self::settings();
        $last_cleanup = get_option(self::LAST_CLEANUP_OPTION, 'Never');

        if (isset($_GET['cleanup']) && $_GET['cleanup'] === '1') {
            echo '<div class="notice notice-success is-dismissible"><p>Maintenance cleanup completed.</p></div>';
        }
        ?>
        <div class="wrap">
            <h1>MigraStacks Performance</h1>

            <form method="post" action="options.php">
                <?php settings_fields('migrastacks_performance'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">Frontend Optimizations</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[disable_emojis]"
                                    value="1"
                                    <?php checked($settings['disable_emojis'], '1'); ?>
                                />
                                Disable emoji scripts/styles
                            </label>
                            <p>
                                <label>
                                    <input
                                        type="checkbox"
                                        name="<?php echo esc_attr(self::OPTION_KEY); ?>[disable_jquery_migrate]"
                                        value="1"
                                        <?php checked($settings['disable_jquery_migrate'], '1'); ?>
                                    />
                                    Remove jQuery Migrate on frontend
                                </label>
                            </p>
                            <p>
                                <label>
                                    <input
                                        type="checkbox"
                                        name="<?php echo esc_attr(self::OPTION_KEY); ?>[strip_asset_version_query]"
                                        value="1"
                                        <?php checked($settings['strip_asset_version_query'], '1'); ?>
                                    />
                                    Strip `ver` query string from local assets
                                </label>
                            </p>
                            <p>
                                <label>
                                    <input
                                        type="checkbox"
                                        name="<?php echo esc_attr(self::OPTION_KEY); ?>[disable_embed_script]"
                                        value="1"
                                        <?php checked($settings['disable_embed_script'], '1'); ?>
                                    />
                                    Disable `wp-embed` script
                                </label>
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Runtime Limits</th>
                        <td>
                            <p>
                                <label for="migrastacks_heartbeat_interval">Heartbeat Interval (seconds)</label>
                                <input
                                    type="number"
                                    min="15"
                                    max="120"
                                    id="migrastacks_heartbeat_interval"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[heartbeat_interval]"
                                    value="<?php echo esc_attr($settings['heartbeat_interval']); ?>"
                                />
                            </p>
                            <p>
                                <label for="migrastacks_revisions_limit">Post Revision Limit (0 = WordPress default)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    id="migrastacks_revisions_limit"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[revisions_limit]"
                                    value="<?php echo esc_attr($settings['revisions_limit']); ?>"
                                />
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Automated Maintenance</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[enable_daily_transient_cleanup]"
                                    value="1"
                                    <?php checked($settings['enable_daily_transient_cleanup'], '1'); ?>
                                />
                                Enable daily expired transient cleanup
                            </label>
                            <p>Last cleanup (UTC): <code><?php echo esc_html((string) $last_cleanup); ?></code></p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save Performance Settings'); ?>
            </form>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="migrastacks_performance_cleanup" />
                <?php wp_nonce_field('migrastacks_performance_cleanup'); ?>
                <?php submit_button('Run Cleanup Now', 'secondary', 'submit', false); ?>
            </form>
        </div>
        <?php
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
            'disable_emojis' => '1',
            'disable_jquery_migrate' => '1',
            'strip_asset_version_query' => '1',
            'disable_embed_script' => '1',
            'enable_daily_transient_cleanup' => '1',
            'heartbeat_interval' => '60',
            'revisions_limit' => '20',
        ];
    }

    private static function ensure_cleanup_schedule(): void
    {
        if (wp_next_scheduled(self::CLEANUP_HOOK)) {
            return;
        }

        wp_schedule_event(time() + MINUTE_IN_SECONDS * 5, 'daily', self::CLEANUP_HOOK);
    }

    private static function clear_cleanup_schedule(): void
    {
        $timestamp = wp_next_scheduled(self::CLEANUP_HOOK);
        while ($timestamp) {
            wp_unschedule_event($timestamp, self::CLEANUP_HOOK);
            $timestamp = wp_next_scheduled(self::CLEANUP_HOOK);
        }
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
        WP_CLI::add_command('migrastacks performance cleanup', [self::class, 'cli_cleanup']);
        WP_CLI::add_command('migrastacks performance status', [self::class, 'cli_status']);
    }

    public static function cli_cleanup(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);
        self::run_cleanup();
        WP_CLI::success('Performance cleanup executed.');
    }

    public static function cli_status(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);
        $settings = self::settings();
        $rows = [];
        foreach ($settings as $key => $value) {
            $rows[] = [
                'setting' => (string) $key,
                'value' => is_scalar($value) ? (string) $value : wp_json_encode($value),
            ];
        }
        $rows[] = [
            'setting' => 'next_cleanup_utc',
            'value' => ($next = wp_next_scheduled(self::CLEANUP_HOOK)) ? gmdate('c', (int) $next) : 'not scheduled',
        ];
        $rows[] = [
            'setting' => 'last_cleanup_utc',
            'value' => (string) get_option(self::LAST_CLEANUP_OPTION, 'never'),
        ];

        \WP_CLI\Utils\format_items('table', $rows, ['setting', 'value']);
    }
}

register_activation_hook(__FILE__, ['MigraStacks_Performance_Plugin', 'activate']);
register_deactivation_hook(__FILE__, ['MigraStacks_Performance_Plugin', 'deactivate']);
MigraStacks_Performance_Plugin::init();
