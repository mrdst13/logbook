// ═══════════════════════════════════════════
// SUPABASE — client init + auth (Phase 1)
// ═══════════════════════════════════════════
//
// Status: SKELETON. The Supabase project + keys must be created before
// this file becomes functional. Until then:
//   - SUPABASE_URL and SUPABASE_ANON_KEY are empty strings.
//   - Auth.client returns null, Auth.isReady() returns false.
//   - The rest of the app continues to read/write localStorage unchanged.
//
// Setup steps for Martin: see private/SUPABASE-SETUP-GUIDE.md (moved out
// of the deployed tree — audit 2026-06-09: tracked .md files are served
// publicly by Cloudflare Pages).
//
// Patterns enforced:
//   - RLS owner-scoped (auth.uid() = user_id) — enforced server-side, see schema.sql.
//   - Anon key OK to ship (designed public when RLS is correct).
//   - Service-role key NEVER in client (would bypass RLS).
//   - Session storage via Supabase default (localStorage). CSP + esc()
//     already mitigate XSS exfil risk; revisit if we ship a JSON-restore
//     change that drops escape on a captain-name field.
//   - TOTP via supabase.auth.mfa.* (Phase 1 optional, hard-nudge after 3 flights).
//   - Trust device 60d: deferred — see TODO in this file + schema.sql trusted_devices.
//   - Password reset must re-prompt TOTP before issuing session (Phase 1 TODO).

// ─────────────────────────────────────────────────────────────────
// Configuration — fill these in after creating the Supabase project.
// See private/SUPABASE-SETUP-GUIDE.md step 3.
// ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://hhsuvauqpgyzrxxqxoss.supabase.co';
// Supabase "publishable" key — safe to ship in client code (the project's
// RLS is owner-scoped, nothing is granted to anon). NOT the secret key.
const SUPABASE_ANON_KEY = 'sb_publishable_fjdRGE_-1-VO2YUKVVWrGQ_Yqr4HJ-A';

// ─────────────────────────────────────────────────────────────────
// Auth module — wraps supabase-js with Cumulo-specific helpers.
// ─────────────────────────────────────────────────────────────────
const Auth = {
  client: null,           // SupabaseClient | null
  session: null,          // current Session or null
  user: null,             // current User or null
  _listeners: [],         // onAuthChange callbacks
  _ready: false,

  // Returns true iff the client is configured AND we've completed the
  // initial getSession() call. Other modules should gate Supabase calls
  // behind isReady() to fail soft when keys are missing (skeleton mode).
  isReady() { return this._ready && !!this.client; },

  isAuthenticated() { return this.isReady() && !!this.session; },

  currentUserId() { return this.user ? this.user.id : null; },

  // Bootstrap: create the client + hydrate the session. Safe to call
  // when SUPABASE_URL/KEY are empty — degrades to skeleton mode.
  async init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.log('[Auth] Skeleton mode — Supabase keys not configured. App falls back to localStorage-only.');
      this._ready = false;
      return;
    }
    if (typeof window.supabase === 'undefined') {
      console.warn('[Auth] supabase-js UMD not loaded (CDN script missing).');
      this._ready = false;
      return;
    }
    try {
      this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      });
      const { data } = await this.client.auth.getSession();
      this.session = data.session || null;
      this.user = this.session ? this.session.user : null;
      this._ready = true;

      // Subscribe to auth changes (signin/signout/refresh).
      this.client.auth.onAuthStateChange((event, session) => {
        this.session = session || null;
        this.user = session ? session.user : null;
        this._listeners.forEach(fn => { try { fn(event, session); } catch (e) { console.warn('[Auth] listener threw:', e); } });
        // Password reset deep-link: Supabase exchanges the recovery hash
        // into a session and fires 'PASSWORD_RECOVERY'. We must prompt
        // the user to choose a new password before they can use the app.
        if (event === 'PASSWORD_RECOVERY' && typeof AuthUI !== 'undefined') {
          AuthUI.open('reset-password');
        }
      });

      console.log('[Auth] Ready. Session:', this.isAuthenticated() ? this.user.email : 'none');
    } catch (e) {
      console.error('[Auth] init failed:', e);
      this._ready = false;
    }
  },

  onAuthChange(fn) { this._listeners.push(fn); },

  // ── Sign-up / sign-in ───────────────────────────────────────────
  async signUp(email, password) {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    return await this.client.auth.signUp({ email, password });
  },

  async signIn(email, password) {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    return await this.client.auth.signInWithPassword({ email, password });
  },

  async signOut() {
    if (!this.isReady()) return;
    await this.client.auth.signOut();
  },

  // ── Account deletion (server-side, atomic) ──────────────────────────
  // POSTs to the Worker's /delete-account endpoint with the user's VERIFIED
  // access token. The Worker resolves the uid server-side and hard-deletes the
  // auth user with the service-role key; ON DELETE CASCADE wipes the profile,
  // flights and trusted_devices. Returns { error } on failure so the caller can
  // ABORT before wiping local — we never half-delete (local gone, cloud alive).
  async deleteAccount() {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    const { data } = await this.client.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) return { error: { message: 'Not signed in.' } };
    let resp;
    try {
      resp = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-account', accessToken: token })
      });
    } catch (e) {
      return { error: { message: 'Could not reach the deletion service.' } };
    }
    if (!resp.ok) {
      let msg = 'Cloud deletion failed.';
      try { const j = await resp.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch {}
      return { error: { message: msg } };
    }
    try { await this.client.auth.signOut(); } catch {}
    this.session = null; this.user = null;
    return { error: null };
  },

  // ── Password reset (TODO: re-prompt TOTP before issuing session) ───
  async requestPasswordReset(email) {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    // The reset link Supabase emails will bring the user back to the app
    // with a special URL hash. We let supabase-js detectSessionInUrl
    // handle exchange, then prompt for a new password.
    return await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/',
    });
  },

  async updatePassword(newPassword) {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    return await this.client.auth.updateUser({ password: newPassword });
  },

  // ── TOTP MFA (Phase 1 optional; hard-nudge after 3 flights logged) ───
  // Flow:
  //   1. enrollTOTP() → returns QR + secret. Show to user.
  //   2. user scans QR with Google Authenticator / Authy / 1Password.
  //   3. user types the 6-digit code → verifyTOTP(factorId, code).
  //   4. on success, generate + show 8 single-use backup codes.
  //
  // Security: backup codes must be hashed server-side and shown
  // ONCE. Supabase handles this internally for the `recovery_codes` API,
  // but we still need to display + force user to download/print before
  // they leave the modal.
  async enrollTOTP() {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    return await this.client.auth.mfa.enroll({ factorType: 'totp' });
  },

  async verifyTOTPEnroll(factorId, code) {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    const challengeResp = await this.client.auth.mfa.challenge({ factorId });
    if (challengeResp.error) return challengeResp;
    return await this.client.auth.mfa.verify({
      factorId,
      challengeId: challengeResp.data.id,
      code,
    });
  },

  async listMFAFactors() {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    return await this.client.auth.mfa.listFactors();
  },

  async unenrollMFA(factorId) {
    if (!this.isReady()) return { error: { message: 'Auth not configured.' } };
    return await this.client.auth.mfa.unenroll({ factorId });
  },

  // ── Trust device (TODO Phase 1.1) ─────────────────────────────────
  // The Supabase MFA API does not have a built-in "trust this browser"
  // primitive. Implementation pattern:
  //   1. On MFA success with "Trust 60 days" checkbox checked, generate
  //      a 32-byte random token. Hash it with SHA-256.
  //   2. INSERT INTO public.trusted_devices (user_id, device_hash,
  //      user_agent, expires_at) VALUES (...);
  //   3. Store raw token in localStorage key `cumulo_device_token`.
  //   4. On next login, after password but BEFORE MFA challenge: send
  //      the raw token; if SHA-256(token) ∈ trusted_devices for this
  //      user_id AND expires_at > now() → skip MFA.
  //
  // We're punting this to a follow-up commit so the first end-to-end
  // auth flow is testable end-to-end without this extra surface.
};

// ─────────────────────────────────────────────────────────────────
// Error normalization — friendly i18n-ready messages.
// ─────────────────────────────────────────────────────────────────
function normalizeAuthError(err) {
  if (!err) return '';
  const msg = (err.message || err.error_description || String(err)).toLowerCase();
  if (msg.includes('invalid login') || msg.includes('invalid_credentials')) {
    return t('auth.err.invalidCredentials');
  }
  if (msg.includes('email not confirmed')) {
    return t('auth.err.emailNotConfirmed');
  }
  if (msg.includes('user already registered')) {
    return t('auth.err.alreadyRegistered');
  }
  if (msg.includes('rate limit') || msg.includes('429')) {
    return t('auth.err.rateLimit');
  }
  if (msg.includes('password') && msg.includes('weak')) {
    return t('auth.err.weakPassword');
  }
  return err.message || t('auth.err.generic');
}

// ─────────────────────────────────────────────────────────────────
// Auth modal UI — renders into #authModal element (see body.html).
// State machine: 'signin' | 'signup' | 'forgot' | 'mfa-challenge' |
//                'mfa-enroll' | 'reset-password'
// ─────────────────────────────────────────────────────────────────
const AuthUI = {
  state: 'signin',
  pendingMFAFactorId: null,

  open(initialState = 'signin') {
    this.state = initialState;
    const modal = document.getElementById('authModal');
    if (!modal) return;
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    this.render();
    // 'mfa-enroll' is the only state that needs an async kick-off to
    // fetch the QR code + secret from Supabase. Other states are pure forms.
    if (initialState === 'mfa-enroll') this.submitMFAEnrollStart();
  },

  close() {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    // Security: if the user dismisses the MFA challenge mid-flow, they
    // already hold an AAL1 session. We sign them out so they can't
    // bypass TOTP by just closing the modal.
    if (this.state === 'mfa-challenge' && typeof Auth !== 'undefined' && Auth.isAuthenticated()) {
      Auth.signOut().catch(e => console.warn('[Auth] signOut on close failed:', e));
    }
    this.pendingMFAFactorId = null;
    modal.classList.remove('show');
    document.body.style.overflow = '';
  },

  render() {
    const body = document.getElementById('authModalBody');
    if (!body) return;
    switch (this.state) {
      case 'signin':         body.innerHTML = this._signinForm(); break;
      case 'signup':         body.innerHTML = this._signupForm(); break;
      case 'forgot':         body.innerHTML = this._forgotForm(); break;
      case 'mfa-challenge':  body.innerHTML = this._mfaChallengeForm(); break;
      case 'mfa-enroll':     body.innerHTML = this._mfaEnrollForm(); break;
      case 'reset-password': body.innerHTML = this._resetPasswordForm(); break;
      default:               body.innerHTML = this._signinForm();
    }
  },

  // ── Forms (minimal, FR/EN via t()) ───────────────────────────────
  _signinForm() {
    return `
      <h2 class="auth-title">${t('auth.signin.title')}</h2>
      <p class="auth-sub">${t('auth.signin.sub')}</p>
      <form onsubmit="event.preventDefault(); AuthUI.submitSignin();" class="auth-form">
        <label class="auth-label">${t('auth.email.label')}
          <input type="email" id="auth-email" autocomplete="username" required class="auth-input">
        </label>
        <label class="auth-label">${t('auth.password.label')}
          <input type="password" id="auth-password" autocomplete="current-password" required class="auth-input">
        </label>
        <label class="auth-checkbox">
          <input type="checkbox" id="auth-trust-device">
          <span>${t('auth.trustDevice.label')}</span>
        </label>
        <div id="auth-err" class="auth-err"></div>
        <button type="submit" class="btn btn-primary auth-submit">${t('auth.signin.btn')}</button>
        <div class="auth-links">
          <a href="#" onclick="event.preventDefault(); AuthUI.state='forgot'; AuthUI.render();">${t('auth.forgot.link')}</a>
          <a href="#" onclick="event.preventDefault(); AuthUI.state='signup'; AuthUI.render();">${t('auth.signup.link')}</a>
        </div>
      </form>
    `;
  },

  _signupForm() {
    return `
      <h2 class="auth-title">${t('auth.signup.title')}</h2>
      <p class="auth-sub">${t('auth.signup.sub')}</p>
      <form onsubmit="event.preventDefault(); AuthUI.submitSignup();" class="auth-form">
        <label class="auth-label">${t('auth.email.label')}
          <input type="email" id="auth-email" autocomplete="username" required class="auth-input">
        </label>
        <label class="auth-label">${t('auth.password.label')}
          <input type="password" id="auth-password" autocomplete="new-password" minlength="12" required class="auth-input">
          <small class="auth-help">${t('auth.password.help')}</small>
        </label>
        <div id="auth-err" class="auth-err"></div>
        <button type="submit" class="btn btn-primary auth-submit">${t('auth.signup.btn')}</button>
        <div class="auth-links">
          <a href="#" onclick="event.preventDefault(); AuthUI.state='signin'; AuthUI.render();">${t('auth.haveAccount.link')}</a>
        </div>
      </form>
    `;
  },

  _forgotForm() {
    return `
      <h2 class="auth-title">${t('auth.forgot.title')}</h2>
      <p class="auth-sub">${t('auth.forgot.sub')}</p>
      <form onsubmit="event.preventDefault(); AuthUI.submitForgot();" class="auth-form">
        <label class="auth-label">${t('auth.email.label')}
          <input type="email" id="auth-email" autocomplete="username" required class="auth-input">
        </label>
        <div id="auth-err" class="auth-err"></div>
        <button type="submit" class="btn btn-primary auth-submit">${t('auth.forgot.btn')}</button>
        <div class="auth-links">
          <a href="#" onclick="event.preventDefault(); AuthUI.state='signin'; AuthUI.render();">${t('auth.backToSignin.link')}</a>
        </div>
      </form>
    `;
  },

  _mfaChallengeForm() {
    return `
      <h2 class="auth-title">${t('auth.mfa.title')}</h2>
      <p class="auth-sub">${t('auth.mfa.sub')}</p>
      <form onsubmit="event.preventDefault(); AuthUI.submitMFAChallenge();" class="auth-form">
        <label class="auth-label">${t('auth.mfa.codeLabel')}
          <input type="text" id="auth-mfa-code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="auth-input auth-input-otp">
        </label>
        <div id="auth-err" class="auth-err"></div>
        <button type="submit" class="btn btn-primary auth-submit">${t('auth.mfa.btn')}</button>
      </form>
    `;
  },

  _mfaEnrollForm() {
    // Populated dynamically by submitMFAEnrollStart() — see below.
    return `
      <h2 class="auth-title">${t('auth.mfaEnroll.title')}</h2>
      <p class="auth-sub">${t('auth.mfaEnroll.sub')}</p>
      <div id="auth-mfa-qr" class="auth-qr"></div>
      <p class="auth-help" id="auth-mfa-secret"></p>
      <form onsubmit="event.preventDefault(); AuthUI.submitMFAEnrollVerify();" class="auth-form">
        <label class="auth-label">${t('auth.mfaEnroll.verifyLabel')}
          <input type="text" id="auth-mfa-code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required class="auth-input auth-input-otp">
        </label>
        <div id="auth-err" class="auth-err"></div>
        <button type="submit" class="btn btn-primary auth-submit">${t('auth.mfaEnroll.btn')}</button>
        <button type="button" class="btn btn-ghost" onclick="AuthUI.close()">${t('auth.mfaEnroll.later')}</button>
      </form>
    `;
  },

  _resetPasswordForm() {
    return `
      <h2 class="auth-title">${t('auth.reset.title')}</h2>
      <p class="auth-sub">${t('auth.reset.sub')}</p>
      <form onsubmit="event.preventDefault(); AuthUI.submitResetPassword();" class="auth-form">
        <label class="auth-label">${t('auth.password.newLabel')}
          <input type="password" id="auth-password" autocomplete="new-password" minlength="12" required class="auth-input">
        </label>
        <div id="auth-err" class="auth-err"></div>
        <button type="submit" class="btn btn-primary auth-submit">${t('auth.reset.btn')}</button>
      </form>
    `;
  },

  // ── Handlers ──────────────────────────────────────────────────────
  _showErr(msg) {
    const el = document.getElementById('auth-err');
    if (el) el.textContent = msg;
  },

  // Disable the submit button + show a pending label during async auth calls
  // so the user gets feedback and can't double-submit on a slow connection.
  _setBusy(busy, label) {
    const btn = document.querySelector('.auth-submit');
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) {
      if (btn.dataset.label === undefined) btn.dataset.label = btn.textContent;
      btn.textContent = label || '…';
    } else if (btn.dataset.label !== undefined) {
      btn.textContent = btn.dataset.label;
      delete btn.dataset.label;
    }
  },

  async submitSignin() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    this._showErr('');
    this._setBusy(true, t('auth.signin.btn') + '…');
    try {
      const { data, error } = await Auth.signIn(email, password);
      if (error) { this._showErr(normalizeAuthError(error)); return; }

      // Check if the user has MFA enrolled and needs to challenge.
      const factors = await Auth.listMFAFactors();
      const totp = factors && factors.data && factors.data.totp && factors.data.totp.find(f => f.status === 'verified');
      if (totp) {
        this.pendingMFAFactorId = totp.id;
        this.state = 'mfa-challenge';
        this.render();
        return;
      }
      this.close();
      onAuthSuccess();
    } finally {
      this._setBusy(false);
    }
  },

  async submitSignup() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    this._showErr('');
    if (password.length < 12) { this._showErr(t('auth.err.weakPassword')); return; }
    this._setBusy(true, t('auth.signup.btn') + '…');
    let error;
    try {
      ({ error } = await Auth.signUp(email, password));
    } finally {
      this._setBusy(false);
    }
    if (error) { this._showErr(normalizeAuthError(error)); return; }
    showToast(t('auth.signup.checkEmail'), 'success');
    this.state = 'signin';
    this.render();
  },

  async submitForgot() {
    const email = document.getElementById('auth-email').value.trim();
    this._showErr('');
    const { error } = await Auth.requestPasswordReset(email);
    if (error) { this._showErr(normalizeAuthError(error)); return; }
    showToast(t('auth.forgot.sent'), 'success');
    this.state = 'signin';
    this.render();
  },

  async submitMFAChallenge() {
    const code = document.getElementById('auth-mfa-code').value.trim();
    this._showErr('');
    if (!Auth.client) return;
    const challengeResp = await Auth.client.auth.mfa.challenge({ factorId: this.pendingMFAFactorId });
    if (challengeResp.error) { this._showErr(normalizeAuthError(challengeResp.error)); return; }
    const verifyResp = await Auth.client.auth.mfa.verify({
      factorId: this.pendingMFAFactorId,
      challengeId: challengeResp.data.id,
      code,
    });
    if (verifyResp.error) { this._showErr(normalizeAuthError(verifyResp.error)); return; }
    this.close();
    onAuthSuccess();
  },

  async submitMFAEnrollStart() {
    const { data, error } = await Auth.enrollTOTP();
    if (error) { this._showErr(normalizeAuthError(error)); return; }
    this.pendingMFAFactorId = data.id;
    // Assign the QR src via DOM (not innerHTML) so a tampered Supabase
    // response cannot break out of the attribute and inject markup.
    const qr = document.getElementById('auth-mfa-qr');
    if (qr) {
      qr.innerHTML = '';
      const img = document.createElement('img');
      img.alt = t('auth.mfaEnroll.qrAlt');
      img.style.cssText = 'width:200px;height:200px;';
      img.src = data.totp.qr_code;
      qr.appendChild(img);
    }
    const sec = document.getElementById('auth-mfa-secret');
    if (sec) sec.textContent = t('auth.mfaEnroll.manualKey') + ' ' + data.totp.secret;
  },

  async submitMFAEnrollVerify() {
    const code = document.getElementById('auth-mfa-code').value.trim();
    this._showErr('');
    const resp = await Auth.verifyTOTPEnroll(this.pendingMFAFactorId, code);
    if (resp.error) { this._showErr(normalizeAuthError(resp.error)); return; }
    // TODO: generate + show 8 single-use backup codes here, force user
    // to download .txt or print before closing. Supabase doesn't auto-issue
    // these — we need to mint+hash them ourselves and store in a
    // `mfa_backup_codes` table.
    showToast(t('auth.mfaEnroll.success'), 'success');
    this.close();
  },

  async submitResetPassword() {
    const password = document.getElementById('auth-password').value;
    this._showErr('');
    if (password.length < 12) { this._showErr(t('auth.err.weakPassword')); return; }
    const { error } = await Auth.updatePassword(password);
    if (error) { this._showErr(normalizeAuthError(error)); return; }
    showToast(t('auth.reset.success'), 'success');
    this.close();
  },
};

// ─────────────────────────────────────────────────────────────────
// onAuthSuccess — called after a successful signin or MFA verify.
// Hooks the migration flow (if user has localStorage data) and pulls
// remote flights for cross-device sync.
// ─────────────────────────────────────────────────────────────────
async function onAuthSuccess() {
  showToast(t('auth.welcome'), 'success');
  // Refresh header / nav so the auth state is visible.
  if (typeof renderAuthStateUI === 'function') renderAuthStateUI();
  // Trigger migration check (see 19-sync.js).
  if (typeof Sync !== 'undefined' && Sync.runMigrationIfNeeded) {
    await Sync.runMigrationIfNeeded();
  }
  // Pull remote flights (cross-device sync).
  if (typeof Sync !== 'undefined' && Sync.pullFlights) {
    await Sync.pullFlights();
  }
}

// ─────────────────────────────────────────────────────────────────
// Header UI helper — show signed-in email / signin button.
// Wired into 99-init.js after Auth.init().
// ─────────────────────────────────────────────────────────────────
function renderAuthStateUI() {
  const slot = document.getElementById('authStatusSlot');
  if (!slot) return;
  if (Auth.isAuthenticated()) {
    slot.innerHTML = `
      <span class="auth-email">${esc(Auth.user.email)}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="Auth.signOut().then(() => location.reload())">${t('auth.signout.btn')}</button>
    `;
  } else if (Auth.isReady()) {
    slot.innerHTML = `<button type="button" class="btn btn-primary btn-sm" onclick="AuthUI.open('signin')">${t('auth.signin.btn')}</button>`;
  } else {
    // Skeleton mode — Supabase not configured yet.
    slot.innerHTML = '';
  }
  // Keep the Settings → Sync account card in sync with auth state.
  if (typeof renderAccountSettings === 'function') renderAccountSettings();
}

// ─────────────────────────────────────────────────────────────────
// Settings → Sync → Cloud account card: show the signed-in email and a
// change-password form. updateUser({password}) works on the current
// authenticated session, so the user can set a new password they actually
// know and sign in with it on their other devices (phone, etc.).
// ─────────────────────────────────────────────────────────────────
function renderAccountSettings() {
  const card = document.getElementById('account-card');
  if (!card) return;
  const statusEl = document.getElementById('account-status');
  const signedinEl = document.getElementById('account-signedin');
  const signedIn = (typeof Auth !== 'undefined' && Auth.isAuthenticated && Auth.isAuthenticated());
  if (signedIn) {
    if (statusEl) statusEl.textContent = t('account.signedInAs', { email: (Auth.user ? Auth.user.email : '') });
    if (signedinEl) signedinEl.style.display = '';
  } else {
    if (statusEl) {
      statusEl.textContent = (typeof Auth !== 'undefined' && Auth.isReady && Auth.isReady())
        ? t('account.notSignedIn')
        : t('account.notConfigured');
    }
    if (signedinEl) signedinEl.style.display = 'none';
  }
}

async function changeAccountPassword() {
  const p1 = (document.getElementById('account-newpass') || {}).value || '';
  const p2 = (document.getElementById('account-newpass2') || {}).value || '';
  const msg = document.getElementById('account-msg');
  const setMsg = (text, ok) => {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = ok ? 'var(--success)' : 'var(--danger)';
  };
  if (typeof Auth === 'undefined' || !Auth.isAuthenticated || !Auth.isAuthenticated()) {
    setMsg(t('account.mustSignIn'), false);
    return;
  }
  if (p1.length < 12) { setMsg(t('auth.err.weakPassword'), false); return; }
  if (p1 !== p2) { setMsg(t('account.pwMismatch'), false); return; }
  setMsg(t('account.updating'), true);
  try {
    const { error } = await Auth.updatePassword(p1);
    if (error) { setMsg(normalizeAuthError(error), false); return; }
  } catch (e) {
    setMsg(t('account.pwUpdateFailed'), false);
    return;
  }
  const f1 = document.getElementById('account-newpass'); if (f1) f1.value = '';
  const f2 = document.getElementById('account-newpass2'); if (f2) f2.value = '';
  setMsg(t('account.pwChangedLong'), true);
  if (typeof showToast === 'function') showToast(t('account.pwChanged'), 'success');
}

// Show/hide BOTH change-password fields at once (Edge's native reveal eye is
// inconsistent — it appears on one field but not the other).
function toggleAccountPasswordVisibility() {
  const show = !!((document.getElementById('account-showpass') || {}).checked);
  ['account-newpass', 'account-newpass2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.type = show ? 'text' : 'password';
  });
}
