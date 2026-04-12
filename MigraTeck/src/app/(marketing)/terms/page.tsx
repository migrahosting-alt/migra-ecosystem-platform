import { LegalPageShell } from "@/components/marketing/legal-page-shell";
import {
  buildLegalMetadata,
  LEGAL_PAGE_PATHS,
  MIGRADRIVE_LEGAL_CONTACT,
  MIGRADRIVE_LEGAL_LAST_UPDATED,
} from "@/lib/legal";

export const metadata = buildLegalMetadata({
  title: "Terms of Service",
  description: "MigraDrive Terms of Service",
  path: LEGAL_PAGE_PATHS.terms,
});

export default function TermsPage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      lastUpdated={MIGRADRIVE_LEGAL_LAST_UPDATED}
      summary="These terms govern access to MigraDrive across the web console, APIs, and client applications, including account responsibilities, acceptable use, plan limits, billing outcomes, and service protections."
    >
      <h2>1. Agreement</h2>
      <p>
        These Terms of Service govern your access to and use of MigraDrive. By accessing or using the service, you agree to these Terms. If you do not agree, do not use MigraDrive.
      </p>

      <h2>2. Services</h2>
      <p>MigraDrive provides cloud storage services, including:</p>
      <ul>
        <li>file storage and file organization</li>
        <li>file synchronization</li>
        <li>file sharing and version history</li>
        <li>web, mobile, desktop, and API-based access</li>
      </ul>

      <h2>3. Eligibility and Accounts</h2>
      <p>You must provide accurate account information and keep your credentials secure.</p>
      <p>
        You are responsible for activity under your account and for maintaining the confidentiality of your login credentials.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to use MigraDrive to:</p>
      <ul>
        <li>upload or distribute unlawful material</li>
        <li>store or transmit malware or harmful code</li>
        <li>interfere with or disrupt the service</li>
        <li>attempt unauthorized access to accounts, tenants, or systems</li>
        <li>infringe the rights of others</li>
      </ul>
      <p>We may restrict, suspend, or terminate accounts that violate these rules.</p>

      <h2>5. Plans, Limits, and Billing</h2>
      <p>
        MigraDrive plans may include storage limits, usage limits, or feature restrictions. If your usage exceeds plan limits, uploads or certain actions may be restricted.
      </p>
      <p>
        Paid plans are billed according to the pricing presented at sign-up or renewal. Failure to pay may result in read-only restrictions, suspension, or account disablement according to our billing policy.
      </p>

      <h2>6. Your Content</h2>
      <p>
        You retain ownership of the files and content you upload. You grant MigraDrive the limited rights necessary to host, store, process, transfer, preview, and deliver that content as part of the service.
      </p>

      <h2>7. Data Protection and Backups</h2>
      <p>
        We work to protect data and operate the service reliably, but no platform is risk free. You remain responsible for maintaining your own backups for critical or irreplaceable content.
      </p>

      <h2>8. Availability</h2>
      <p>
        We aim to maintain high service availability, but we do not guarantee uninterrupted or error-free operation at all times.
      </p>

      <h2>9. Suspension and Termination</h2>
      <p>We may suspend, restrict, or terminate access if:</p>
      <ul>
        <li>you violate these Terms</li>
        <li>we detect abuse, fraud, or security threats</li>
        <li>payment obligations are not met</li>
        <li>we are required to do so by law</li>
      </ul>
      <p>You may stop using the service at any time.</p>

      <h2>10. Intellectual Property</h2>
      <p>
        MigraDrive and its software, branding, and service materials remain the property of {MIGRADRIVE_LEGAL_CONTACT.operatorName} and its licensors. These Terms do not transfer ownership of the platform to you.
      </p>

      <h2>11. Disclaimer</h2>
      <p>MigraDrive is provided on an "as is" and "as available" basis to the maximum extent permitted by law.</p>

      <h2>12. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, {MIGRADRIVE_LEGAL_CONTACT.operatorName} will not be liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, revenue, data, or business opportunities arising from your use of the service.
      </p>

      <h2>13. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Continued use of MigraDrive after changes take effect means you accept the updated Terms.
      </p>

      <h2>14. Governing Law</h2>
      <p>
        These Terms are governed by applicable laws of the United States and the State of Florida, without regard to conflict of law principles, unless otherwise required by law.
      </p>

      <h2>15. Contact</h2>
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
        Email: <a href={`mailto:${MIGRADRIVE_LEGAL_CONTACT.legalEmail}`}>{MIGRADRIVE_LEGAL_CONTACT.legalEmail}</a>
        <br />
        Website: <a href={MIGRADRIVE_LEGAL_CONTACT.websiteUrl}>{MIGRADRIVE_LEGAL_CONTACT.websiteHost}</a>
      </p>
    </LegalPageShell>
  );
}
