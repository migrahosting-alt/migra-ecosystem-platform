<?php
/**
 * MigraStacks SMTP constants sample.
 * Copy into wp-config.php and replace with real values.
 * Environment variables with the same names are also supported.
 */

define('MIGRASTACKS_SMTP_HOST', 'smtp.example.com');
define('MIGRASTACKS_SMTP_PORT', 587);
define('MIGRASTACKS_SMTP_AUTH', true);
define('MIGRASTACKS_SMTP_USER', 'smtp-user@example.com');
define('MIGRASTACKS_SMTP_PASS', 'replace-with-real-password');
define('MIGRASTACKS_SMTP_SECURE', 'tls'); // tls|ssl|empty
define('MIGRASTACKS_SMTP_TIMEOUT', 15); // seconds

define('MIGRASTACKS_MAIL_FROM', 'noreply@example.com');
define('MIGRASTACKS_MAIL_FROM_NAME', 'MigraStacks');
