(function initMigraVoiceSiteConfig() {
  const config = {
    links: {
      bundleEnterpriseCheckout: 'https://www.migrahosting.com/checkout?bundle=bundle-enterprise',
      bundleGrowthCheckout: 'https://www.migrahosting.com/checkout?bundle=bundle-growth',
      bundleStarterCheckout: 'https://www.migrahosting.com/checkout?bundle=bundle-starter',
      clientPortal: 'https://control.migrahosting.com/client/',
      clientPortalWelcome: 'https://control.migrahosting.com/client/?welcome=1',
      home: '/',
      migrahostingVoice: 'https://www.migrahosting.com/voice',
      salesEmail: 'mailto:sales@migrahosting.com',
      signup: '/signup.html',
      smsTerms: '/sms-terms.html',
      softphone: 'https://call.migrahosting.com',
      softphoneDownloads: 'https://call.migrahosting.com/downloads/',
      supportEmail: 'mailto:support@migrahosting.com'
    },
    labels: {
      clientPortal: 'Client Portal'
    }
  };

  function getSection(sectionName) {
    return config[sectionName] || {};
  }

  window.MIGRAVOICE_SITE_CONFIG = config;
  window.getMigraVoiceLink = function getMigraVoiceLink(key, fallback) {
    return getSection('links')[key] || fallback || '';
  };
  window.getMigraVoiceText = function getMigraVoiceText(key, fallback) {
    return getSection('labels')[key] || fallback || '';
  };
  window.applyMigraVoiceSiteConfig = function applyMigraVoiceSiteConfig(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-site-link]').forEach((element) => {
      const key = element.getAttribute('data-site-link');
      if (!key) {
        return;
      }
      const href = window.getMigraVoiceLink(key, element.getAttribute('href') || '');
      if (href) {
        element.setAttribute('href', href);
      }
    });

    scope.querySelectorAll('[data-site-text]').forEach((element) => {
      const key = element.getAttribute('data-site-text');
      if (!key) {
        return;
      }
      const text = window.getMigraVoiceText(key, element.textContent || '');
      if (text) {
        element.textContent = text;
      }
    });
  };
})();