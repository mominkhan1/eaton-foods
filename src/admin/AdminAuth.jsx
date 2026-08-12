import { createContext, useCallback, useContext, useState } from 'react';
import { storeConfig } from '../data/store';
import mark from '../assets/eat-on-mark.png';

/**
 * Admin gate.
 *
 * ⚠️ THIS IS NOT AUTHENTICATION. The passcode is compared in the browser, so
 * anyone who opens devtools can read it and let themselves in. It exists to
 * keep the panel out of the way during development and demos.
 *
 * Before this goes anywhere near a real shop it must be replaced with a
 * server-side session: the panel should render nothing until an API call
 * authorises it, and every repository write should be authorised again on the
 * server. See README § Not yet wired up.
 */
const DEV_PASSCODE = '1234';
const SESSION_KEY = 'eaton.admin.session';

const AdminAuthContext = createContext(null);

export function AdminAuthProvider({ children }) {
  const [isAuthed, setIsAuthed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'yes';
    } catch {
      return false;
    }
  });

  const signIn = useCallback((passcode) => {
    if (passcode.trim() !== DEV_PASSCODE) return false;

    setIsAuthed(true);
    try {
      // Session, not local — closing the tab signs the shop out.
      sessionStorage.setItem(SESSION_KEY, 'yes');
    } catch {
      // Fine: the sign-in just won't survive a refresh.
    }
    return true;
  }, []);

  const signOut = useCallback(() => {
    setIsAuthed(false);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing to clean up.
    }
  }, []);

  return (
    <AdminAuthContext.Provider value={{ isAuthed, signIn, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) throw new Error('useAdminAuth must be used inside an AdminAuthProvider');
  return context;
}

export function AdminLogin() {
  const { signIn } = useAdminAuth();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState(false);

  function onSubmit(event) {
    event.preventDefault();
    if (!signIn(passcode)) {
      setError(true);
      setPasscode('');
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-surface-100 px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6">
        <img src={mark} alt="" aria-hidden="true" width={70} height={44} className="h-11 w-auto" />

        <h1 className="mt-4 text-3xl text-ink-950">{storeConfig.name} admin</h1>
        <p className="mt-1 text-sm text-ink-500">Enter the shop passcode.</p>

        <input
          type="password"
          className="field mt-5"
          value={passcode}
          onChange={(event) => {
            setPasscode(event.target.value);
            setError(false);
          }}
          placeholder="Passcode"
          aria-label="Passcode"
          autoFocus
          inputMode="numeric"
        />

        {error && <p className="mt-2 text-sm text-chilli-500">Wrong passcode.</p>}

        <button type="submit" className="btn-primary mt-4 w-full">
          Sign in
        </button>

        <p className="mt-5 rounded-xl bg-chilli-500/10 px-4 py-3 text-xs text-chilli-500">
          <strong>Not real security.</strong> The passcode ({DEV_PASSCODE}) is checked in the
          browser and readable by anyone. Replace with a server session before going live.
        </p>
      </form>
    </div>
  );
}
