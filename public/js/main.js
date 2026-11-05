(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------- navigation & small UI bits ----------

  const toggle = $('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  $$('.flash-close').forEach((b) => b.addEventListener('click', () => b.closest('.flash').remove()));

  const filtersToggle = $('.filters-toggle');
  if (filtersToggle) {
    filtersToggle.addEventListener('click', () => {
      const open = $('.filters').classList.toggle('open');
      filtersToggle.setAttribute('aria-expanded', String(open));
    });
  }

  $$('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => {
    const form = el.form;
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return form.reset();
    form.submit();
  }));

  $$('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => {
    if (!window.confirm(f.dataset.confirm)) e.preventDefault();
  }));

  // ---------- phone and email checks (the server repeats these in server.js) ----------

  const phoneProblem = (v) => {
    const digits = v.replace(/\D/g, '');
    const plus = v.startsWith('+');
    const valid = /^\+?\d[\d\s-]*$/.test(v) && ((!plus && /^0[1-9]\d{8}$/.test(digits)) || /^2630?[1-9]\d{8}$/.test(digits)
      || (plus && !digits.startsWith('263') && /^[1-9]\d{7,14}$/.test(digits)));
    return valid ? '' : 'Enter numbers only: 10 digits for Zimbabwe (e.g. 0771234567), or + and the country code for other countries.';
  };
  const emailProblem = (v) => {
    const valid = v.length <= 254 && v.split('@')[0].length <= 64 && !v.includes('..')
      && /^[a-z0-9](?:[a-z0-9._%+-]*[a-z0-9_%+-])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(v);
    return valid ? '' : 'Enter a full email address, e.g. name@gmail.com.';
  };
  const checkField = (el, problem) => {
    const run = () => el.setCustomValidity(el.value.trim() ? problem(el.value.trim()) : '');
    el.addEventListener('input', run);
    run();
  };
  $$('input[type="tel"]').forEach((el) => checkField(el, phoneProblem));
  $$('input[type="email"]:not(#l-email)').forEach((el) => checkField(el, emailProblem));

  // ---------- listing gallery ----------

  $$('[data-gallery]').forEach((g) => {
    const main = $('[data-gallery-main]', g);
    $$('.gallery-thumbs button', g).forEach((btn) => btn.addEventListener('click', () => {
      main.src = btn.dataset.src;
      $$('.gallery-thumbs button', g).forEach((b) => b.classList.toggle('active', b === btn));
    }));
  });

  $$('[data-share]').forEach((btn) => btn.addEventListener('click', async () => {
    const data = { title: btn.dataset.title, url: location.href.split('#')[0] };
    if (navigator.share) {
      try { await navigator.share(data); } catch (e) { /* user cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(data.url);
      btn.textContent = 'Link copied ✓';
      setTimeout(() => { btn.textContent = 'Share'; }, 2000);
    } catch (e) {
      window.prompt('Copy this link:', data.url);
    }
  }));

  // ---------- photo upload preview ----------

  const fileInput = $('#s-photos');
  const preview = $('[data-preview]');
  if (fileInput && preview) {
    fileInput.addEventListener('change', () => {
      preview.innerHTML = '';
      Array.from(fileInput.files).slice(0, 8).forEach((file) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        preview.appendChild(img);
      });
      if (fileInput.files.length > 8) {
        const p = document.createElement('p');
        p.className = 'small muted';
        p.textContent = 'Only the first 8 photos will be uploaded.';
        preview.appendChild(p);
      }
    });
  }

  // ---------- cookie consent ----------

  const VERSION = window.COOKIE_CONSENT_VERSION || 1;
  const banner = $('#cookie-banner');
  const modal = $('#cookie-modal');

  function readConsent() {
    const m = document.cookie.match(/(?:^|;\s*)cookie_consent=([^;]*)/);
    if (!m) return null;
    try {
      const c = JSON.parse(decodeURIComponent(m[1]));
      return c && c.v === VERSION ? c : null;
    } catch (e) { return null; }
  }

  function writeConsent(analytics, marketing) {
    const value = { v: VERSION, necessary: true, analytics: !!analytics, marketing: !!marketing, date: new Date().toISOString() };
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `cookie_consent=${encodeURIComponent(JSON.stringify(value))}; Max-Age=${60 * 60 * 24 * 182}; Path=/; SameSite=Lax${secure}`;
    return value;
  }

  // Scripts tagged <script type="text/plain" data-cookie-category="x"> only run once category x is allowed.
  function activateScripts(consent) {
    $$('script[type="text/plain"][data-cookie-category]').forEach((old) => {
      if (!consent[old.dataset.cookieCategory]) return;
      const s = document.createElement('script');
      for (const a of old.attributes) if (a.name !== 'type') s.setAttribute(a.name, a.value);
      s.text = old.text;
      old.replaceWith(s);
    });
  }

  function updateStatus(consent) {
    const el = $('[data-cookie-status]');
    if (!el) return;
    if (!consent) { el.textContent = "You haven't made a choice yet."; return; }
    const on = ['analytics', 'marketing'].filter((k) => consent[k]);
    el.textContent = `Your current choice: essential${on.length ? ' + ' + on.join(' + ') : ' only'} (saved ${new Date(consent.date).toLocaleDateString()}).`;
  }

  function openModal() {
    const c = readConsent();
    $('#cc-analytics').checked = c ? c.analytics : false;
    $('#cc-marketing').checked = c ? c.marketing : false;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    $('#cc-analytics').focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function finish(consent) {
    if (banner) banner.hidden = true;
    closeModal();
    activateScripts(consent);
    updateStatus(consent);
  }

  if (banner && modal) {
    const existing = readConsent();
    banner.hidden = !!existing;
    if (existing) activateScripts(existing);
    updateStatus(existing);

    document.addEventListener('click', (e) => {
      const action = e.target.closest('[data-cookie-action]');
      if (action) {
        const a = action.dataset.cookieAction;
        if (a === 'accept') finish(writeConsent(true, true));
        else if (a === 'reject') finish(writeConsent(false, false));
        else if (a === 'save') finish(writeConsent($('#cc-analytics').checked, $('#cc-marketing').checked));
        else if (a === 'settings') openModal();
        return;
      }
      if (e.target.closest('[data-cookie-settings]')) openModal();
      if (e.target.closest('[data-cookie-close]')) closeModal();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  }
})();
