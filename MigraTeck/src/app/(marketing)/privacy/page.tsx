import { LegalPageShell } from "@/components/marketing/legal-page-shell";
import {
  buildLegalMetadata,
  LEGAL_PAGE_PATHS,
  MIGRADRIVE_LEGAL_CONTACT,
  MIGRADRIVE_LEGAL_LAST_UPDATED,
} from "@/lib/legal";

export const metadata = buildLegalMetadata({
  title: "Privacy Policy",
  description: "MigraDrive Privacy Policy",
  path: LEGAL_PAGE_PATHS.privacy,
});

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      lastUpdated={MIGRADRIVE_LEGAL_LAST_UPDATED}
      summary="This policy explains how MigraDrive collects, uses, stores, and protects account, file, and operational information across the web console, APIs, mobile apps, desktop clients, and related services."
    >
      <h2>1. Introduction</h2>
      <p>
        {MIGRADRIVE_LEGAL_CONTACT.brandName} is a cloud storage service operated by {MIGRADRIVE_LEGAL_CONTACT.operatorName}. This Privacy Policy explains how we collect, use, store, and protect information when you use {MIGRADRIVE_LEGAL_CONTACT.websiteHost}, the {MIGRADRIVE_LEGAL_CONTACT.brandName} web console, mobile apps, desktop apps, APIs, and related services.
      </p>

      <h2>2. Information We Collect</h2>
      <h3>Account Information</h3>
      <ul>
        <li>Email address</li>
        <li>Name, if you choose to provide it</li>
        <li>Organization name and account ownership details</li>
      </ul>

      <h3>Service Data</h3>
      <ul>
        <li>Files and folders you upload or manage through MigraDrive</li>
        <li>File metadata such as file names, sizes, MIME types, timestamps, and version history</li>
        <li>Storage usage, quota information, and tenant status data</li>
      </ul>

      <h3>Technical and Device Data</h3>
      <ul>
        <li>IP address</li>
        <li>Browser type and operating system</li>
        <li>Device type and app version</li>
        <li>Session and authentication metadata</li>
      </ul>

      <h3>Operational Data</h3>
      <ul>
        <li>Recent activity and audit history</li>
        <li>Cleanup, maintenance, and storage operation events</li>
        <li>Error logs, performance telemetry, and security events</li>
      </ul>

      <h2>3. How We Use Information</h2>
      <p>We use collected information to:</p>
      <ul>
        <li>Provide and operate MigraDrive</li>
        <li>Authenticate users and secure accounts</li>
        <li>Store, retrieve, sync, preview, and share files</li>
        <li>Enforce plan limits, billing state, and quota policies</li>
        <li>Detect abuse, fraud, unauthorized access, and service misuse</li>
        <li>Improve service performance, reliability, and support operations</li>
      </ul>

      <h2>4. File Content and Ownership</h2>
      <p>
        You retain ownership of your files and content. MigraDrive processes file content only as needed to deliver the service, including storage, retrieval, synchronization, preview generation, file versioning, and security scanning or validation where applicable.
      </p>
      <p>
        We do not sell your files or file content. We do not access your content for advertising purposes.
      </p>

      <h2>5. Cookies and Similar Technologies</h2>
      <p>We use cookies and similar storage technologies to:</p>
      <ul>
        <li>Maintain login sessions</li>
        <li>Secure authentication and refresh tokens</li>
        <li>Remember cookie consent choices</li>
        <li>Support core site functionality and limited service analytics</li>
      </ul>
      <p>Where required by law, we request consent before setting non-essential cookies.</p>

      <h2>6. Legal Bases for Processing</h2>
      <p>Where GDPR or similar laws apply, we process personal data under one or more of these bases:</p>
      <ul>
        <li>Performance of a contract when we provide the service you signed up for</li>
        <li>Legitimate interests in securing, maintaining, and improving MigraDrive</li>
        <li>Consent, where legally required for optional cookies or communications</li>
        <li>Compliance with legal obligations</li>
      </ul>

      <h2>7. Data Sharing</h2>
      <p>We do not sell personal data. We may share information only with:</p>
      <ul>
        <li>Infrastructure and hosting providers</li>
        <li>Storage and delivery providers</li>
        <li>Payment processors for billing operations</li>
        <li>Service providers supporting security, monitoring, or communications</li>
        <li>Authorities when legally required</li>
      </ul>

      <h2>8. Security</h2>
      <p>
        We use reasonable administrative, technical, and organizational safeguards to protect information, including encrypted transport, restricted access, session protection, storage controls, and audit logging.
      </p>
      <p>
        No method of storage or transmission is perfectly secure, but we work to protect customer data against unauthorized access, loss, misuse, and disclosure.
      </p>

      <h2>9. Data Retention</h2>
      <ul>
        <li>Account data is retained while your account is active and for a reasonable period afterward as needed</li>
        <li>Deleted files may remain in trash or backup retention windows before permanent removal</li>
        <li>Security, audit, and operational logs may be retained to protect the service and investigate incidents</li>
      </ul>

      <h2>10. Your Rights</h2>
      <p>Depending on your jurisdiction, you may have the right to:</p>
      <ul>
        <li>Access your personal data</li>
        <li>Correct inaccurate information</li>
        <li>Request deletion of your data</li>
        <li>Request export of your data</li>
        <li>Object to certain processing</li>
        <li>Withdraw consent where processing is based on consent</li>
      </ul>
      <p>
        To make a request, contact <a href={`mailto:${MIGRADRIVE_LEGAL_CONTACT.privacyEmail}`}>{MIGRADRIVE_LEGAL_CONTACT.privacyEmail}</a>.
      </p>

      <h2>11. Children&apos;s Privacy</h2>
      <p>
        MigraDrive is not intended for children under 13, and we do not knowingly collect personal information from children under 13.
      </p>

      <h2>12. International Transfers</h2>
      <p>
        If you access MigraDrive from outside the United States, your information may be processed and stored in the United States or other jurisdictions where our providers operate.
      </p>

      <h2>13. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will post the updated version on this page and revise the last updated date.
      </p>

      <h2>14. Contact</h2>
      <p>
        <strong>{MIGRADRIVE_LEGAL_CONTACT.operatorName}</strong>
        <br />
        {MIGRADRIVE_LEGAL_CONTACT.addressLines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </p>
      <p>
        Email: <a href={`mailto:${MIGRADRIVE_LEGAL_CONTACT.privacyEmail}`}>{MIGRADRIVE_LEGAL_CONTACT.privacyEmail}</a>
        <br />
        Website: <a href={MIGRADRIVE_LEGAL_CONTACT.websiteUrl}>{MIGRADRIVE_LEGAL_CONTACT.websiteHost}</a>
      </p>
    </LegalPageShell>
  );
}
