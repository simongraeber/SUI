import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { FaGoogle } from "react-icons/fa";
import { fadeUpIndexed } from "@/lib/animations";
import { loginWithGoogleCode } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import loginImage from "../assets/LogInImage.webp";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

function buildGoogleAuthUrl(redirectUri: string) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Build the redirect target from state (preserving search params), or fall back
  // to whatever was saved in sessionStorage (survives the Google OAuth round-trip),
  // or default to /dashboard.
  const stateFrom = location.state as { from?: { pathname: string; search?: string } } | null;
  const fromPath = stateFrom?.from
    ? `${stateFrom.from.pathname}${stateFrom.from.search ?? ""}`
    : sessionStorage.getItem("redirectAfterLogin") ?? "/dashboard";

  // Persist so it survives the full-page Google redirect
  useEffect(() => {
    if (stateFrom?.from) {
      sessionStorage.setItem("redirectAfterLogin", fromPath);
    }
  }, [stateFrom, fromPath]);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const redirectUri = `${window.location.origin}/login`;

  // Handle the OAuth2 callback (code in query string)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code) return;

    // Clean the URL so the code isn't visible / reused
    window.history.replaceState({}, "", "/login");

    setLoading(true);
    setError(null);
    loginWithGoogleCode(code, redirectUri)
      .then((res) => {
        login(res.access_token);
        const target = sessionStorage.getItem("redirectAfterLogin") ?? "/dashboard";
        sessionStorage.removeItem("redirectAfterLogin");
        navigate(target, { replace: true });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Login failed");
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGoogleLogin = () => {
    setError(null);
    window.location.href = buildGoogleAuthUrl(redirectUri);
  };

  return (
    <div className="login-page">
      {/* hero image */}
      <motion.div
        className="login-image-wrapper"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" as const }}
      >
        <img src={loginImage} alt="Foosball action" className="login-hero-img" />
      </motion.div>

      {/* content */}
      <div className="login-content">
        <motion.img
          src="/LogoSIU.svg"
          alt="SIU Logo"
          className="login-logo logo-light"
          custom={0}
          variants={fadeUpIndexed}
          initial="hidden"
          animate="show"
        />
        <motion.img
          src="/LogoSIUDark.svg"
          alt="SIU Logo"
          className="login-logo logo-dark"
          custom={0}
          variants={fadeUpIndexed}
          initial="hidden"
          animate="show"
        />

        <motion.h1
          className="login-title"
          custom={1}
          variants={fadeUpIndexed}
          initial="hidden"
          animate="show"
        >
          Sign in or create&nbsp;your&nbsp;account
        </motion.h1>

        <motion.p
          className="login-subtitle"
          custom={2}
          variants={fadeUpIndexed}
          initial="hidden"
          animate="show"
        >
          Use your Google account to sign&nbsp;up or log&nbsp;in instantly —
          no extra passwords needed.
        </motion.p>

        <motion.div
          custom={3}
          variants={fadeUpIndexed}
          initial="hidden"
          animate="show"
        >
          <Button
            size="lg"
            className="mt-4 gap-2.5 bg-gradient-to-br from-[var(--cta-bg-from)] to-[var(--cta-bg-to)] shadow-lg shadow-primary/30 hover:shadow-primary/45 text-white"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            <FaGoogle className="text-lg" />
            {loading ? "Signing in…" : "Continue with Google"}
          </Button>
          {error && (
            <p className="text-sm text-red-500 mt-2">{error}</p>
          )}
        </motion.div>

        <motion.p
          className="text-xs opacity-55 mt-3"
          custom={4}
          variants={fadeUpIndexed}
          initial="hidden"
          animate="show"
        >
          By continuing you agree to our{" "}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </motion.p>
      </div>
    </div>
  );
}

export default LoginPage;
