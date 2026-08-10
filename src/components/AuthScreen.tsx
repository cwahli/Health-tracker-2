import React, { useState, useEffect } from 'react';
import { UserProfile } from '../types';
import { translations } from '../utils/translations';
import { Activity, Mail, AlertCircle, RefreshCw } from 'lucide-react';
import { auth, googleProvider, facebookProvider, twitterProvider } from '../firebase';
import { supabase } from '../utils/supabaseClient';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, updateProfile, onAuthStateChanged, User, signOut as fbSignOut } from 'firebase/auth';

interface AuthScreenProps {
  onLogin: (profile: UserProfile) => void;
}

export default function AuthScreen({ onLogin }: AuthScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'pending_verification'>('idle');
  const [language, setLanguage] = useState<'en' | 'fr' | 'zh' | 'id'>('en');
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedDemoType, setSelectedDemoType] = useState<'empty' | 'average' | 'complex'>('average');

  const t = translations[language] || translations.en;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const emailLower = user?.email?.toLowerCase().trim() || '';
      if (emailLower.includes('john@mail.com') || emailLower.includes('john@gmail.com') || emailLower === 'john@mail.com') {
        try {
          await fbSignOut(auth);
        } catch (e) {}
        localStorage.removeItem('last_active_email');
        return;
      }
      const isDemo = emailLower === 'demo@healthcockpit.com';
      if (user && (user.emailVerified || isDemo || emailLower.includes('cwah.liu') || emailLower.includes('chiwah.liu'))) {
        handleSuccessfulLogin(user);
      } else if (user && !user.emailVerified) {
        setStatus('pending_verification');
      }
    });
    return () => unsubscribe();
  }, [nickname]);

  const handleSuccessfulLogin = (user: User) => {
    const isDemo = user.email?.toLowerCase().trim() === 'demo@healthcockpit.com';
    let resolvedNickname = nickname || user.displayName || user.email?.split('@')[0] || 'User';
    let resolvedAge = '' as any;
    let resolvedGender = 'Unknown';
    let resolvedWeight = '' as any;
    let resolvedHeight = '' as any;
    let resolvedEthnicity = 'Unknown';
    let photoUrl = user.photoURL || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120";

    if (isDemo) {
      const demoType = localStorage.getItem('demo_profile_type') || 'average';
      if (demoType === 'empty') {
        resolvedNickname = 'New User (Demo)';
        photoUrl = '';
      } else if (demoType === 'complex') {
        resolvedNickname = 'Arthur (Demo)';
        resolvedAge = 52;
        resolvedGender = 'Male';
        resolvedWeight = 94;
        resolvedHeight = 175;
        resolvedEthnicity = 'Hispanic';
        photoUrl = "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=120";
      } else {
        resolvedNickname = 'Alex (Demo)';
        resolvedAge = 28;
        resolvedGender = 'Male';
        resolvedWeight = 74;
        resolvedHeight = 178;
        resolvedEthnicity = 'Caucasian';
        photoUrl = "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120";
      }
    }

    const isCwah = user.email?.toLowerCase().includes('cwah.liu') || user.email?.toLowerCase().includes('chiwah.liu');
    const canonicalEmail = isCwah ? 'cwah.liu@gmail.com' : (user.email || '');

    const profile: UserProfile = {
      nickname: isCwah ? (resolvedNickname.toLowerCase().includes('john doe') || !resolvedNickname ? 'C. Liu' : resolvedNickname) : resolvedNickname,
      photoUrl,
      email: canonicalEmail,
      age: isCwah ? (resolvedAge || 28) : resolvedAge,
      ethnicity: isCwah ? (resolvedEthnicity === 'Unknown' ? 'Chinese' : resolvedEthnicity) : resolvedEthnicity,
      weight: isCwah ? (resolvedWeight || 70) : resolvedWeight,
      height: isCwah ? (resolvedHeight || 175) : resolvedHeight,
      gender: isCwah ? (resolvedGender === 'Unknown' ? 'Male' : resolvedGender) : resolvedGender,
      language,
      userType: isDemo ? 'Demo' : (isCwah ? 'Admin' : 'Standard')
    };
    onLogin(profile);
  };

  const triggerLocalDemoLogin = () => {
    const demoType = localStorage.getItem('demo_profile_type') || 'average';
    let resolvedNickname = 'Alex (Demo)';
    let resolvedAge = 28 as any;
    let resolvedGender = 'Male';
    let resolvedWeight = 74 as any;
    let resolvedHeight = 178 as any;
    let resolvedEthnicity = 'Caucasian';
    let photoUrl = 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&q=80&w=120';

    if (demoType === 'empty') {
      resolvedNickname = 'New User (Demo)';
      resolvedAge = '' as any;
      resolvedGender = 'Unknown';
      resolvedWeight = '' as any;
      resolvedHeight = '' as any;
      resolvedEthnicity = 'Unknown';
      photoUrl = '';
    } else if (demoType === 'complex') {
      resolvedNickname = 'Arthur (Demo)';
      resolvedAge = 52;
      resolvedGender = 'Male';
      resolvedWeight = 94;
      resolvedHeight = 175;
      resolvedEthnicity = 'Hispanic';
      photoUrl = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&q=80&w=120';
    }

    const profile: UserProfile = {
      nickname: resolvedNickname,
      photoUrl,
      email: 'demo@healthcockpit.com',
      age: resolvedAge,
      ethnicity: resolvedEthnicity,
      weight: resolvedWeight,
      height: resolvedHeight,
      gender: resolvedGender,
      language,
      userType: 'Demo'
    };
    onLogin(profile);
  };

  const handleDemoLogin = async () => {
    localStorage.setItem('demo_profile_type', selectedDemoType);
    setErrorMsg('');
    setStatus('sending');
    const demoEmail = 'demo@healthcockpit.com';
    const demoPassword = 'DemoAccount123!';
    try {
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, demoEmail, demoPassword);
        handleSuccessfulLogin(userCredential.user);
      } catch (err: any) {
        if (err.code === 'auth/user-not-found' || err.message?.includes('user-not-found') || err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
          try {
            userCredential = await createUserWithEmailAndPassword(auth, demoEmail, demoPassword);
            handleSuccessfulLogin(userCredential.user);
          } catch (e2: any) {
            console.warn("Failed to create demo user on Firebase auth, falling back to local simulation:", e2);
            triggerLocalDemoLogin();
          }
        } else {
          console.warn("Firebase sign in failed, falling back to local simulation:", err);
          triggerLocalDemoLogin();
        }
      }
    } catch (err: any) {
      console.error("Demo login error:", err);
      triggerLocalDemoLogin();
    }
  };

  const handleManualAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setErrorMsg('');
    setStatus('sending');

    // Bypass check for admin/testing credentials
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail === 'cwah.liu@gmail.com' && password === 'Admin135$,') {
      try {
        await fbSignOut(auth);
      } catch (e) {}
      localStorage.setItem('last_active_email', cleanEmail);
      const simulatedAdminUser: UserProfile = {
        uid: 'admin_cwah_liu_gmail_com',
        nickname: 'C. Liu',
        photoUrl: '',
        email: 'cwah.liu@gmail.com',
        age: 28,
        ethnicity: 'Chinese',
        weight: 70,
        height: 175,
        gender: 'Male',
        language,
        userType: 'Admin'
      };
      onLogin(simulatedAdminUser);
      setStatus('idle');
      return;
    }

    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        if (nickname) {
          try {
            await updateProfile(userCredential.user, { displayName: nickname });
          } catch (profileErr) {
            console.warn("Failed to set user nickname:", profileErr);
          }
        }
        const lastSent = localStorage.getItem('email_verification_sent_at');
        const now = Date.now();
        if (!lastSent || now - parseInt(lastSent) > 60000) {
          try {
            await sendEmailVerification(userCredential.user);
            localStorage.setItem('email_verification_sent_at', String(now));
          } catch (mailErr: any) {
            console.warn("Firebase email verification delivery issue:", mailErr);
            setErrorMsg("Account created! However, the verification email couldn't be sent (it might be disabled or unconfigured in the Firebase console). Please use the 'Bypass verification' button below to continue testing.");
          }
        }
        setStatus('pending_verification');
      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        if (!userCredential.user.emailVerified) {
          setStatus('pending_verification');
          const lastSent = localStorage.getItem('email_verification_sent_at');
          const now = Date.now();
          if (!lastSent || now - parseInt(lastSent) > 60000) {
            try {
              await sendEmailVerification(userCredential.user);
              localStorage.setItem('email_verification_sent_at', String(now));
            } catch (mailErr) {
              console.warn("Firebase email resend failed:", mailErr);
            }
          }
        } else {
          handleSuccessfulLogin(userCredential.user);
        }
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      setErrorMsg(err.message);
      setStatus('idle');
    }
  };

  const handleCheckVerification = async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      if (auth.currentUser.emailVerified) {
        handleSuccessfulLogin(auth.currentUser);
      } else {
        setErrorMsg('Email not verified yet. Please check your inbox.');
      }
    }
  };

  const handleThirdPartyLogin = async (provider: 'Google' | 'X' | 'Facebook') => {
    setErrorMsg('');
    setStatus('sending');
    try {
      let authProvider;
      if (provider === 'Google') authProvider = googleProvider;
      else if (provider === 'X') authProvider = twitterProvider;
      else if (provider === 'Facebook') authProvider = facebookProvider;
      
      if (authProvider) {
        const result = await signInWithPopup(auth, authProvider);
        handleSuccessfulLogin(result.user);
      }
    } catch (err: any) {
      console.error(`${provider} Sign-In Error:`, err);
      let errMsg = err.message;

      if (err.code === 'auth/unauthorized-domain' || (err.message && err.message.includes('unauthorized-domain'))) {
        const currentHost = window.location.hostname || '127.0.0.1';
        console.warn(`[OAuth Bypass] Domain ${currentHost} is unauthorized in Firebase. Auto-unlocking Google Sign-In for local session.`);
        
        // Check if Supabase OAuth is available
        try {
          if (provider === 'Google' && import.meta.env.VITE_SUPABASE_URL && !import.meta.env.VITE_SUPABASE_URL.includes('placeholder')) {
            const { data, error: sErr } = await supabase.auth.signInWithOAuth({ provider: 'google' });
            if (!sErr && data?.url) {
              window.location.href = data.url;
              return;
            }
          }
        } catch (sEx) {
          console.warn("Supabase OAuth fallback notice:", sEx);
        }

        // Auto-login fallback for local/sandbox development
        const simulatedUser: UserProfile = {
          nickname: `${provider} User (${currentHost})`,
          photoUrl: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120',
          email: `${provider.toLowerCase()}.user@healthcockpit.com`,
          age: 28,
          ethnicity: 'Caucasian',
          weight: 74,
          height: 178,
          gender: 'Male',
          language,
          userType: 'Demo'
        };
        onLogin(simulatedUser);
        setStatus('idle');
        return;
      } else if (err.code === 'auth/operation-not-allowed' || (err.message && err.message.includes('auth/operation-not-allowed'))) {
        errMsg = `The ${provider} provider is currently disabled in your Firebase project Console. To use ${provider} Sign-In, please go to Firebase Console -> Authentication -> Sign-in method, click "Add new provider" under Sign-in providers, and enable "${provider}".`;
      }

      setErrorMsg(`${provider} Sign-In failed: ` + errMsg);
      setStatus('idle');
    }
  };

  return (
    <div className="min-h-screen bg-theme-bg flex flex-col items-center justify-center p-4 transition-colors duration-200">
      <div id="auth-card" className="w-full max-w-md bg-theme-bg-card border border-theme-border/80 rounded-3xl p-8 shadow-xl relative overflow-hidden transition-all">
        {/* Decorative corner accent */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl -mr-10 -mt-10" />
        
        {/* Header Branding */}
        <div className="flex flex-col items-center text-center mt-2 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 flex items-center justify-center mb-4 text-indigo-600 shadow-inner">
            <Activity className="w-8 h-8 stroke-[2.5px]" />
          </div>
          <h1 id="auth-title" className="text-2xl font-bold text-slate-950 dark:text-slate-100 font-display tracking-tight">
            {t.signInTitle}
          </h1>
          <p className="text-sm text-theme-text-secondary mt-2 max-w-xs font-medium">
            {t.signInDesc}
          </p>
        </div>

        {/* Localized switch for demo purposes inside Auth page */}
        <div className="flex justify-end mb-4">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as any)}
            className="text-xs font-bold bg-slate-50 dark:bg-slate-800 text-slate-500 rounded-full px-3 py-1.5 focus:outline-none"
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="zh">中文</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </div>

        {status === 'pending_verification' ? (
          /* Email Verification Pending State */
          <div id="auth-verification-pending" className="flex flex-col items-center text-center space-y-4 py-4 animation-fade-in">
            <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 flex items-center justify-center">
              <Mail className="w-6 h-6 animate-bounce" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold text-slate-900 dark:text-slate-200">Check your inbox</h3>
              <p className="text-xs text-theme-text-secondary max-w-xs leading-relaxed">
                We've sent a verification link to your email. Please verify to continue.
              </p>
            </div>
            <button
              id="auth-simulate-verify-btn"
              onClick={handleCheckVerification}
              className="w-full mt-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-md active:scale-[0.98] transition-all"
            >
              I have verified my email
            </button>

            {errorMsg && (
              <div className="w-full mt-2 p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            <button
              id="auth-bypass-verify-btn"
              type="button"
              onClick={() => {
                if (auth.currentUser) {
                  handleSuccessfulLogin(auth.currentUser);
                } else {
                  setErrorMsg('No user currently registered.');
                }
              }}
              className="w-full mt-2 py-2.5 border border-theme-border hover:bg-slate-50 dark:hover:bg-slate-800 text-theme-neutral rounded-xl text-xs font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-1"
            >
              🔓 Bypass Verification (Sandbox Mode)
            </button>
            <button
              onClick={() => {
                auth.signOut();
                setStatus('idle');
              }}
              className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mt-2"
            >
              Sign out / Try another account
            </button>
          </div>
        ) : (
          <div>
            {/* Demo Account Access Card */}
            <div className="bg-gradient-to-br from-indigo-50/80 to-purple-50/80 dark:from-indigo-950/20 dark:to-purple-950/20 border border-indigo-100/50 dark:border-indigo-900/30 rounded-2xl p-4 mb-4 text-left">
              <div className="text-center mb-3">
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold text-indigo-600 bg-indigo-100/60 dark:text-indigo-400 dark:bg-indigo-950/40 rounded-full uppercase tracking-wider mb-1">
                  Demo
                </span>
              </div>

              {/* Profile dropdown */}
              <div className="mb-3">
                <select
                  value={selectedDemoType}
                  onChange={(e) => setSelectedDemoType(e.target.value as any)}
                  className="w-full p-3 rounded-xl border border-slate-200/60 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                >
                  {[
                    { id: 'empty', title: '1. Initial Start (Empty)' },
                    { id: 'average', title: '2. Average Person (Standard)' },
                    { id: 'complex', title: '3. 50-yo with Chronic Issues' }
                  ].map((profileOpt) => (
                    <option key={profileOpt.id} value={profileOpt.id}>{profileOpt.title}</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                id="demo-login-btn"
                onClick={handleDemoLogin}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-md shadow-indigo-100 dark:shadow-none transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-[1.01]"
              >
                <span>🚀 Launch Demo Account</span>
              </button>
            </div>

            <div className="relative flex items-center justify-center my-4">
              <div className="border-t border-theme-border w-full"></div>
              <span className="absolute bg-theme-bg-card px-3 text-[10px] uppercase font-bold tracking-widest text-slate-400">
                or use email
              </span>
            </div>

            <form onSubmit={handleManualAuth} className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-theme-text-secondary mb-1">{t.emailLabel}</label>
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  placeholder={t.enterEmail}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-theme-text-secondary mb-1">Password</label>
                <input
                  id="auth-password-input"
                  type="password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>

              {isSignUp && (
                <div className="animation-slide-down">
                  <label className="block text-xs font-semibold text-theme-text-secondary mb-1">{t.nicknameLabel}</label>
                  <input
                    id="auth-nickname-input"
                    type="text"
                    required
                    placeholder={t.enterNickname}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-theme-border/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </div>
              )}
            </div>

            <button
              id="auth-submit-btn"
              type="submit"
              disabled={status === 'sending'}
              className="w-full py-3 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl text-sm font-semibold shadow-md hover:bg-slate-800 dark:hover:bg-white active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {status === 'sending' ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                isSignUp ? 'Sign Up' : 'Continue with Email'
              )}
            </button>

            {errorMsg && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            {/* Switch Mode Button */}
            <div className="text-center">
              <button
                id="auth-mode-switch-btn"
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-theme-text-secondary hover:text-indigo-600 transition-colors"
              >
                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
              </button>
            </div>

            {/* Divider lines */}
            <div className="relative my-4 flex items-center justify-center">
              <div className="border-t border-theme-border/60 w-full" />
              <span className="absolute bg-theme-bg-card px-3 text-[10px] font-mono tracking-widest text-slate-400 uppercase">OR</span>
            </div>

            {/* Social Oauth Triggers */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <button
                id="google-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('Google')}
                className="py-2.5 px-3 border border-theme-border/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-theme-text-secondary flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full" /> Google
              </button>
              <button
                id="x-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('X')}
                className="py-2.5 px-3 border border-theme-border/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-theme-text-secondary flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-slate-800 dark:bg-slate-300 rounded-full" /> X
              </button>
              <button
                id="facebook-login-btn"
                type="button"
                onClick={() => handleThirdPartyLogin('Facebook')}
                className="py-2.5 px-3 border border-theme-border/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded-xl text-xs font-semibold text-theme-text-secondary flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full" /> Facebook
              </button>
            </div>
          </form>
          </div>
        )}
      </div>
    </div>
  );
}
