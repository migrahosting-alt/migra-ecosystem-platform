<?php
/**
 * Plugin Name: MigraStacks Deliverability
 * Plugin URI: https://migrateck.com
 * Description: Enterprise SMTP policy, diagnostics, and mail observability for MigraStacks WordPress deployments.
 * Version: 2.0.0
 * Author: MigraStacks
 * Author URI: https://migrateck.com
 * License: GPL2+
 * Text Domain: migrastacks-deliverability
 */

if (! defined('ABSPATH')) {
    exit;
}

final class MigraStacks_Deliverability_Plugin
{
    private const OPTION_KEY = 'migrastacks_deliverability_settings';
    private const LOG_OPTION_KEY = 'migrastacks_deliverability_mail_log';
    private const HARD_MAX_LOG_ENTRIES = 5000;

    public static function init(): void
    {
        add_action('admin_menu', [self::class, 'register_admin_page']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('admin_notices', [self::class, 'smtp_notice']);
        add_action('admin_post_migrastacks_send_test_mail', [self::class, 'handle_send_test_mail']);
        add_action('admin_post_migrastacks_clear_mail_log', [self::class, 'handle_clear_mail_log']);

        add_action('phpmailer_init', [self::class, 'configure_phpmailer']);
        add_filter('wp_mail_from', [self::class, 'from_email']);
        add_filter('wp_mail_from_name', [self::class, 'from_name']);
        add_action('wp_mail_failed', [self::class, 'log_failed_mail']);
        add_action('wp_mail_succeeded', [self::class, 'log_success_mail']);

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

        if (null === get_option(self::LOG_OPTION_KEY, null)) {
            add_option(self::LOG_OPTION_KEY, [], '', 'no');
        }
    }

    public static function register_admin_page(): void
    {
        add_options_page(
            'MigraStacks Deliverability',
            'MigraStacks Deliverability',
            'manage_options',
            'migrastacks-deliverability',
            [self::class, 'render_settings_page']
        );
    }

    public static function register_settings(): void
    {
        register_setting('migrastacks_deliverability', self::OPTION_KEY, [
            'type' => 'array',
            'sanitize_callback' => [self::class, 'sanitize_settings'],
            'default' => self::defaults(),
        ]);
    }

    public static function sanitize_settings(array $input): array
    {
        $max_logs = isset($input['max_logs']) ? (int) $input['max_logs'] : 500;
        $max_logs = max(50, min(self::HARD_MAX_LOG_ENTRIES, $max_logs));

        $timeout = isset($input['smtp_timeout']) ? (int) $input['smtp_timeout'] : 15;
        $timeout = max(5, min(60, $timeout));

        $email = sanitize_email($input['default_from_email'] ?? '');
        if ($email !== '' && ! is_email($email)) {
            $email = '';
        }

        return [
            'enable_failure_logging' => ! empty($input['enable_failure_logging']) ? '1' : '0',
            'enable_success_logging' => ! empty($input['enable_success_logging']) ? '1' : '0',
            'max_logs' => (string) $max_logs,
            'default_from_email' => $email,
            'default_from_name' => sanitize_text_field($input['default_from_name'] ?? 'MigraStacks'),
            'smtp_timeout' => (string) $timeout,
        ];
    }

    public static function settings_link(array $links): array
    {
        $links[] = '<a href="' . esc_url(admin_url('options-general.php?page=migrastacks-deliverability')) . '">Settings</a>';
        return $links;
    }

    public static function configure_phpmailer(PHPMailer\PHPMailer\PHPMailer $phpmailer): void
    {
        $host = trim((string) self::config_value('MIGRASTACKS_SMTP_HOST', 'MIGRASTACKS_SMTP_HOST', ''));
        if ($host === '') {
            return;
        }

        $phpmailer->isSMTP();
        $phpmailer->Host = $host;
        $phpmailer->Port = max(1, (int) self::config_value('MIGRASTACKS_SMTP_PORT', 'MIGRASTACKS_SMTP_PORT', 587));
        $phpmailer->SMTPAuth = self::config_bool('MIGRASTACKS_SMTP_AUTH', 'MIGRASTACKS_SMTP_AUTH', true);
        $phpmailer->Username = (string) self::config_value('MIGRASTACKS_SMTP_USER', 'MIGRASTACKS_SMTP_USER', '');
        $phpmailer->Password = (string) self::config_value('MIGRASTACKS_SMTP_PASS', 'MIGRASTACKS_SMTP_PASS', '');
        $phpmailer->SMTPAutoTLS = true;

        $secure = strtolower(trim((string) self::config_value('MIGRASTACKS_SMTP_SECURE', 'MIGRASTACKS_SMTP_SECURE', 'tls')));
        if (! in_array($secure, ['', 'tls', 'ssl'], true)) {
            $secure = 'tls';
        }
        $phpmailer->SMTPSecure = $secure;

        $timeout = (int) self::config_value('MIGRASTACKS_SMTP_TIMEOUT', 'MIGRASTACKS_SMTP_TIMEOUT', self::settings()['smtp_timeout']);
        $phpmailer->Timeout = max(5, min(60, $timeout));
    }

    public static function from_email(string $from): string
    {
        $configured = sanitize_email((string) self::config_value('MIGRASTACKS_MAIL_FROM', 'MIGRASTACKS_MAIL_FROM', ''));
        if ($configured !== '' && is_email($configured)) {
            return $configured;
        }

        $default_from_email = sanitize_email((string) (self::settings()['default_from_email'] ?? ''));
        if ($default_from_email !== '' && is_email($default_from_email)) {
            return $default_from_email;
        }

        if (! empty($from) && is_email($from)) {
            return $from;
        }

        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            $host = 'localhost';
        }

        return 'wordpress@' . preg_replace('/^www\./', '', $host);
    }

    public static function from_name(string $name): string
    {
        $configured = trim((string) self::config_value('MIGRASTACKS_MAIL_FROM_NAME', 'MIGRASTACKS_MAIL_FROM_NAME', ''));
        if ($configured !== '') {
            return sanitize_text_field($configured);
        }

        $default_from_name = trim((string) (self::settings()['default_from_name'] ?? ''));
        if ($default_from_name !== '') {
            return sanitize_text_field($default_from_name);
        }

        if (! empty($name)) {
            return $name;
        }

        return wp_specialchars_decode(get_option('blogname'), ENT_QUOTES);
    }

    public static function log_failed_mail(WP_Error $error): void
    {
        if (! self::is_enabled('enable_failure_logging')) {
            return;
        }

        $data = $error->get_error_data();
        $to = '';
        $subject = '';
        if (is_array($data)) {
            $to = self::normalize_recipients($data['to'] ?? []);
            $subject = sanitize_text_field((string) ($data['subject'] ?? ''));
        }

        self::append_log([
            'timestamp' => gmdate('c'),
            'status' => 'failed',
            'to' => $to,
            'subject' => $subject,
            'message' => sanitize_text_field($error->get_error_message()),
        ]);

        self::audit('deliverability.mail_failed', [
            'to' => $to,
            'subject' => $subject,
            'message' => sanitize_text_field($error->get_error_message()),
        ], 'error');
    }

    public static function log_success_mail(array $mail_data): void
    {
        if (! self::is_enabled('enable_success_logging')) {
            return;
        }

        $to = self::normalize_recipients($mail_data['to'] ?? []);
        $subject = sanitize_text_field((string) ($mail_data['subject'] ?? ''));

        self::append_log([
            'timestamp' => gmdate('c'),
            'status' => 'sent',
            'to' => $to,
            'subject' => $subject,
            'message' => 'Mail accepted by wp_mail()',
        ]);
    }

    public static function smtp_notice(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        $smtp_host = trim((string) self::config_value('MIGRASTACKS_SMTP_HOST', 'MIGRASTACKS_SMTP_HOST', ''));
        if ($smtp_host !== '') {
            return;
        }

        echo '<div class="notice notice-warning"><p>';
        echo esc_html('MigraStacks Deliverability is active but SMTP host is not configured. Set MIGRASTACKS_SMTP_* constants or environment variables.');
        echo '</p></div>';
    }

    public static function render_settings_page(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }

        $settings = self::settings();
        $logs = array_slice(array_reverse(self::logs()), 0, 25);

        if (isset($_GET['mail_test']) && $_GET['mail_test'] === 'sent') {
            echo '<div class="notice notice-success is-dismissible"><p>Test email sent successfully.</p></div>';
        }
        if (isset($_GET['mail_test']) && $_GET['mail_test'] === 'failed') {
            echo '<div class="notice notice-error is-dismissible"><p>Test email failed to send. Check SMTP credentials and logs.</p></div>';
        }
        if (isset($_GET['mail_test']) && $_GET['mail_test'] === 'invalid') {
            echo '<div class="notice notice-error is-dismissible"><p>Invalid test email address.</p></div>';
        }
        if (isset($_GET['log_cleared']) && $_GET['log_cleared'] === '1') {
            echo '<div class="notice notice-success is-dismissible"><p>Mail log cleared.</p></div>';
        }
        ?>
        <div class="wrap">
            <h1>MigraStacks Deliverability</h1>

            <form method="post" action="options.php">
                <?php settings_fields('migrastacks_deliverability'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row">Mail Logging</th>
                        <td>
                            <label>
                                <input
                                    type="checkbox"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[enable_failure_logging]"
                                    value="1"
                                    <?php checked($settings['enable_failure_logging'], '1'); ?>
                                />
                                Log failed emails
                            </label>
                            <p>
                                <label>
                                    <input
                                        type="checkbox"
                                        name="<?php echo esc_attr(self::OPTION_KEY); ?>[enable_success_logging]"
                                        value="1"
                                        <?php checked($settings['enable_success_logging'], '1'); ?>
                                    />
                                    Log successful emails (higher volume)
                                </label>
                            </p>
                            <p>
                                <label for="migrastacks_max_logs">Max Log Entries</label>
                                <input
                                    type="number"
                                    min="50"
                                    max="<?php echo esc_attr((string) self::HARD_MAX_LOG_ENTRIES); ?>"
                                    id="migrastacks_max_logs"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[max_logs]"
                                    value="<?php echo esc_attr($settings['max_logs']); ?>"
                                />
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Sender Defaults</th>
                        <td>
                            <p>
                                <label for="migrastacks_default_from_email">Default From Email (fallback)</label><br />
                                <input
                                    type="email"
                                    id="migrastacks_default_from_email"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[default_from_email]"
                                    value="<?php echo esc_attr($settings['default_from_email']); ?>"
                                    class="regular-text"
                                />
                            </p>
                            <p>
                                <label for="migrastacks_default_from_name">Default From Name (fallback)</label><br />
                                <input
                                    type="text"
                                    id="migrastacks_default_from_name"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[default_from_name]"
                                    value="<?php echo esc_attr($settings['default_from_name']); ?>"
                                    class="regular-text"
                                />
                            </p>
                            <p>
                                <label for="migrastacks_smtp_timeout">SMTP Timeout (seconds)</label><br />
                                <input
                                    type="number"
                                    min="5"
                                    max="60"
                                    id="migrastacks_smtp_timeout"
                                    name="<?php echo esc_attr(self::OPTION_KEY); ?>[smtp_timeout]"
                                    value="<?php echo esc_attr($settings['smtp_timeout']); ?>"
                                />
                            </p>
                        </td>
                    </tr>
                </table>
                <?php submit_button('Save Deliverability Settings'); ?>
            </form>

            <hr />

            <h2>Send Test Email</h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="migrastacks_send_test_mail" />
                <?php wp_nonce_field('migrastacks_send_test_mail'); ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="migrastacks_test_email">Recipient</label></th>
                        <td><input type="email" id="migrastacks_test_email" name="test_email" class="regular-text" required /></td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="migrastacks_test_subject">Subject</label></th>
                        <td><input type="text" id="migrastacks_test_subject" name="test_subject" class="regular-text" value="MigraStacks Deliverability Test" /></td>
                    </tr>
                </table>
                <?php submit_button('Send Test Email', 'secondary', 'submit', false); ?>
            </form>

            <h2>Recent Mail Log</h2>
            <?php if (empty($logs)): ?>
                <p>No mail log entries.</p>
            <?php else: ?>
                <table class="widefat striped">
                    <thead>
                        <tr>
                            <th>Timestamp (UTC)</th>
                            <th>Status</th>
                            <th>To</th>
                            <th>Subject</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($logs as $entry): ?>
                            <tr>
                                <td><?php echo esc_html((string) ($entry['timestamp'] ?? '')); ?></td>
                                <td><?php echo esc_html((string) strtoupper((string) ($entry['status'] ?? 'unknown'))); ?></td>
                                <td><?php echo esc_html((string) ($entry['to'] ?? '')); ?></td>
                                <td><?php echo esc_html((string) ($entry['subject'] ?? '')); ?></td>
                                <td><?php echo esc_html((string) ($entry['message'] ?? '')); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>

            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="migrastacks_clear_mail_log" />
                <?php wp_nonce_field('migrastacks_clear_mail_log'); ?>
                <?php submit_button('Clear Mail Log', 'delete', 'submit', false); ?>
            </form>
        </div>
        <?php
    }

    public static function handle_send_test_mail(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized request.');
        }

        check_admin_referer('migrastacks_send_test_mail');

        $to = sanitize_email($_POST['test_email'] ?? '');
        if ($to === '' || ! is_email($to)) {
            self::redirect_admin(['mail_test' => 'invalid']);
        }

        $subject = sanitize_text_field($_POST['test_subject'] ?? 'MigraStacks Deliverability Test');
        if ($subject === '') {
            $subject = 'MigraStacks Deliverability Test';
        }

        $message = "This is a MigraStacks enterprise test email.\n";
        $message .= 'Site: ' . home_url() . "\n";
        $message .= 'UTC: ' . gmdate('c') . "\n";

        $sent = wp_mail($to, $subject, $message);
        if ($sent) {
            self::audit('deliverability.test_mail_sent', ['to' => $to, 'subject' => $subject], 'notice');
            self::redirect_admin(['mail_test' => 'sent']);
        }

        self::audit('deliverability.test_mail_failed', ['to' => $to, 'subject' => $subject], 'error');
        self::redirect_admin(['mail_test' => 'failed']);
    }

    public static function handle_clear_mail_log(): void
    {
        if (! current_user_can('manage_options')) {
            wp_die('Unauthorized request.');
        }

        check_admin_referer('migrastacks_clear_mail_log');
        update_option(self::LOG_OPTION_KEY, []);
        self::audit('deliverability.mail_log_cleared', ['user' => wp_get_current_user()->user_login], 'warning');
        self::redirect_admin(['log_cleared' => '1']);
    }

    private static function redirect_admin(array $query): void
    {
        wp_safe_redirect(
            add_query_arg(
                array_merge(['page' => 'migrastacks-deliverability'], $query),
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
            'enable_failure_logging' => '1',
            'enable_success_logging' => '0',
            'max_logs' => '500',
            'default_from_email' => '',
            'default_from_name' => 'MigraStacks',
            'smtp_timeout' => '15',
        ];
    }

    private static function is_enabled(string $key): bool
    {
        $settings = self::settings();
        return ($settings[$key] ?? '0') === '1';
    }

    private static function logs(): array
    {
        $logs = get_option(self::LOG_OPTION_KEY, []);
        if (! is_array($logs)) {
            return [];
        }
        return $logs;
    }

    private static function append_log(array $entry): void
    {
        $logs = self::logs();
        $logs[] = self::sanitize_log_entry($entry);

        $max = (int) (self::settings()['max_logs'] ?? 500);
        $max = max(50, min(self::HARD_MAX_LOG_ENTRIES, $max));
        if (count($logs) > $max) {
            $logs = array_slice($logs, -1 * $max);
        }

        update_option(self::LOG_OPTION_KEY, $logs);
    }

    private static function sanitize_log_entry(array $entry): array
    {
        return [
            'timestamp' => sanitize_text_field((string) ($entry['timestamp'] ?? gmdate('c'))),
            'status' => sanitize_text_field((string) ($entry['status'] ?? 'unknown')),
            'to' => sanitize_text_field((string) ($entry['to'] ?? '')),
            'subject' => sanitize_text_field((string) ($entry['subject'] ?? '')),
            'message' => sanitize_text_field((string) ($entry['message'] ?? '')),
        ];
    }

    private static function normalize_recipients($to): string
    {
        if (is_string($to)) {
            return sanitize_text_field($to);
        }

        if (is_array($to)) {
            $flat = [];
            foreach ($to as $recipient) {
                $flat[] = sanitize_text_field((string) $recipient);
            }
            return implode(', ', array_filter($flat));
        }

        return '';
    }

    private static function config_value(string $constant, string $environment, $default = '')
    {
        if (defined($constant)) {
            return constant($constant);
        }

        $env = getenv($environment);
        if ($env !== false && $env !== '') {
            return $env;
        }

        return $default;
    }

    private static function config_bool(string $constant, string $environment, bool $default): bool
    {
        $value = self::config_value($constant, $environment, $default ? '1' : '0');
        if (is_bool($value)) {
            return $value;
        }

        $normalized = strtolower(trim((string) $value));
        return in_array($normalized, ['1', 'true', 'yes', 'on'], true);
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
        WP_CLI::add_command('migrastacks mail logs', [self::class, 'cli_logs']);
        WP_CLI::add_command('migrastacks mail clear', [self::class, 'cli_clear']);
        WP_CLI::add_command('migrastacks mail test', [self::class, 'cli_test']);
        WP_CLI::add_command('migrastacks mail status', [self::class, 'cli_status']);
    }

    public static function cli_logs(array $args, array $assoc_args): void
    {
        unset($args);

        $limit = isset($assoc_args['limit']) ? (int) $assoc_args['limit'] : 20;
        $limit = max(1, min(200, $limit));

        $logs = array_slice(array_reverse(self::logs()), 0, $limit);
        if (empty($logs)) {
            WP_CLI::log('No mail log entries.');
            return;
        }

        \WP_CLI\Utils\format_items('table', $logs, ['timestamp', 'status', 'to', 'subject', 'message']);
    }

    public static function cli_clear(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);
        update_option(self::LOG_OPTION_KEY, []);
        WP_CLI::success('Mail log cleared.');
    }

    public static function cli_test(array $args, array $assoc_args): void
    {
        $to = isset($args[0]) ? sanitize_email($args[0]) : '';
        if ($to === '' || ! is_email($to)) {
            WP_CLI::error('Usage: wp migrastacks mail test <recipient@example.com> [--subject="..."]');
        }

        $subject = isset($assoc_args['subject']) ? sanitize_text_field((string) $assoc_args['subject']) : 'MigraStacks Deliverability Test';
        if ($subject === '') {
            $subject = 'MigraStacks Deliverability Test';
        }

        $message = "This is a MigraStacks enterprise CLI test email.\n";
        $message .= 'Site: ' . home_url() . "\n";
        $message .= 'UTC: ' . gmdate('c') . "\n";

        $sent = wp_mail($to, $subject, $message);
        if (! $sent) {
            WP_CLI::error('wp_mail() reported failure. Check logs with: wp migrastacks mail logs --limit=20');
        }

        WP_CLI::success(sprintf('Test email sent to %s', $to));
    }

    public static function cli_status(array $args, array $assoc_args): void
    {
        unset($args, $assoc_args);

        $settings = self::settings();
        $smtp_host = (string) self::config_value('MIGRASTACKS_SMTP_HOST', 'MIGRASTACKS_SMTP_HOST', '');
        $smtp_port = (string) self::config_value('MIGRASTACKS_SMTP_PORT', 'MIGRASTACKS_SMTP_PORT', '587');

        $rows = [
            ['setting' => 'smtp_host_configured', 'value' => $smtp_host !== '' ? 'yes' : 'no'],
            ['setting' => 'smtp_host', 'value' => $smtp_host !== '' ? $smtp_host : '(not set)'],
            ['setting' => 'smtp_port', 'value' => $smtp_port],
            ['setting' => 'failure_logging', 'value' => $settings['enable_failure_logging']],
            ['setting' => 'success_logging', 'value' => $settings['enable_success_logging']],
            ['setting' => 'max_logs', 'value' => $settings['max_logs']],
            ['setting' => 'current_log_entries', 'value' => (string) count(self::logs())],
        ];

        \WP_CLI\Utils\format_items('table', $rows, ['setting', 'value']);
    }
}

register_activation_hook(__FILE__, ['MigraStacks_Deliverability_Plugin', 'activate']);
MigraStacks_Deliverability_Plugin::init();
