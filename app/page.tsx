"use client";

export const dynamic = "force-dynamic";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function HomeContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const errorParam = searchParams.get("error");

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formReason, setFormReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const isSyncingRef = useRef(false);

  // Automatically show the invite form if Google OAuth returned an access/auth error
  useEffect(() => {
    if (errorParam) {
      setShowInviteForm(true);
    }
  }, [errorParam]);

  // Background 5-second polling loop once user is authenticated
  useEffect(() => {
    if (!session?.user?.email) return;

    const pollMailbox = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;

      try {
        await fetch("/api/gmail/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forceLatest: false }),
        });
      } catch (err) {
        console.error("Polling error:", err);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Run first sync immediately on login
    pollMailbox();

    // Poll every 5 seconds
    const interval = setInterval(pollMailbox, 5000);
    return () => clearInterval(interval);
  }, [session]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim()) {
      setErrorMessage("Please fill in your name and email address.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          email: formEmail,
          reason: formReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Failed to submit invite request. Please try again.");
        setSubmitStatus("error");
      } else {
        setSubmitStatus("success");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Network error. Please try again.");
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .simple-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #e5e5e5;
          border-top: 3px solid #000000;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        input:focus, textarea:focus {
          outline: none;
          border-color: #000000 !important;
        }
      `}</style>

      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          color: "#000000",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          padding: "32px 20px",
          boxSizing: "border-box",
        }}
      >
        {status === "loading" || session ? (
          /* Simple Loading Page Only (After Logging In) */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              textAlign: "center",
            }}
          >
            <div className="simple-spinner" />
            <p
              style={{
                fontSize: 16,
                fontWeight: 500,
                margin: 0,
                color: "#000000",
                letterSpacing: "-0.01em",
              }}
            >
              Loading...
            </p>
            {session?.user?.email && (
              <p style={{ fontSize: 13, color: "#666666", margin: 0 }}>
                {session.user.email}
              </p>
            )}
            <button
              onClick={() => signOut()}
              style={{
                marginTop: 24,
                background: "none",
                border: "none",
                color: "#777777",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Sign out
            </button>
          </div>
        ) : showInviteForm ? (
          /* Invite-Only / Request Access View */
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              display: "flex",
              flexDirection: "column",
              padding: "40px 32px",
              border: "1px solid #000000",
              borderRadius: 2,
              boxSizing: "border-box",
              background: "#ffffff",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                borderBottom: "1px solid #000000",
                paddingBottom: 4,
                marginBottom: 20,
                color: "#000000",
                textAlign: "center",
              }}
            >
              Private Preview &bull; Invite Only
            </div>

            <h1
              style={{
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: "0 0 10px 0",
                color: "#000000",
                textAlign: "center",
                textTransform: "uppercase",
              }}
            >
              Request Access
            </h1>

            <p
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                color: "#333333",
                margin: "0 0 20px 0",
                textAlign: "center",
              }}
            >
              Empowerment is currently in closed testing. Only invited members can sign in right now. Request an invitation below to explore my journey.
            </p>

            {errorParam && (
              <div
                style={{
                  background: "#f9f9f9",
                  borderLeft: "3px solid #000000",
                  padding: "10px 14px",
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: "#333333",
                  marginBottom: 20,
                }}
              >
                <strong>Notice:</strong> Your Google account is not yet on the approved testing list. Please submit your details below to get invited.
              </div>
            )}

            {submitStatus === "success" ? (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px 0" }}>
                  Request Received
                </h3>
                <p style={{ fontSize: 14, color: "#444444", lineHeight: 1.5, margin: "0 0 24px 0" }}>
                  Thank you, <strong>{formName}</strong>. Your invitation request for <strong>{formEmail}</strong> has been sent to the platform owner. You will be able to sign in once added.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteForm(false);
                    setSubmitStatus("idle");
                  }}
                  style={{
                    background: "#000000",
                    color: "#ffffff",
                    border: "none",
                    padding: "10px 20px",
                    borderRadius: 4,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Return to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Alex Taylor"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Google Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="youremail@gmail.com"
                    style={inputStyle}
                  />
                  <span style={{ fontSize: 11, color: "#666666", marginTop: 4, display: "block" }}>
                    The email you will use when clicking &ldquo;Sign in with Google&rdquo;
                  </span>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 6,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Why would you like to explore my journey? (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={formReason}
                    onChange={(e) => setFormReason(e.target.value)}
                    placeholder="e.g. Dealing with psoriasis / skin disease, supporter, or researcher"
                    style={{ ...inputStyle, resize: "vertical" }}
                  />
                </div>

                {errorMessage && (
                  <p style={{ color: "#b91c1c", fontSize: 13, margin: 0 }}>
                    {errorMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    width: "100%",
                    background: "#000000",
                    color: "#ffffff",
                    border: "1px solid #000000",
                    padding: "12px 20px",
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                    opacity: isSubmitting ? 0.7 : 1,
                    letterSpacing: "0.02em",
                    marginTop: 8,
                  }}
                >
                  {isSubmitting ? "Submitting Request..." : "Submit Invite Request"}
                </button>

                <div style={{ textAlign: "center", marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setShowInviteForm(false)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#666666",
                      fontSize: 13,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    &larr; Back to Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          /* Plain White / Black Text Sign-In: Psoriasis Journey Platform */
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              padding: "48px 32px",
              border: "1px solid #000000",
              borderRadius: 2,
              boxSizing: "border-box",
            }}
          >
            {/* Header Badge */}
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                borderBottom: "1px solid #000000",
                paddingBottom: 4,
                marginBottom: 24,
                color: "#000000",
              }}
            >
              Psoriasis Awareness & Advocacy
            </div>

            {/* Platform Title */}
            <h1
              style={{
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: "0 0 12px 0",
                color: "#000000",
                textTransform: "uppercase",
              }}
            >
              Empowerment
            </h1>

            {/* Subheading */}
            <p
              style={{
                fontSize: 15,
                fontWeight: 500,
                lineHeight: 1.5,
                margin: "0 0 20px 0",
                color: "#111111",
              }}
            >
              Living beyond the flare-ups. A personal crusade against the physical and emotional scars of psoriasis.
            </p>

            {/* Narrative Quote */}
            <div
              style={{
                background: "#fafafa",
                borderLeft: "2px solid #000000",
                padding: "14px 16px",
                textAlign: "left",
                fontSize: 13,
                lineHeight: 1.6,
                color: "#333333",
                marginBottom: 28,
              }}
            >
              &ldquo;For years, psoriasis dictated what I wore, how I felt in my own skin, and the battles I fought in silence. Empowerment is my story of healing, trial, resilience, and reclaiming self-worth.&rdquo;
            </div>

            {/* Divider line */}
            <div
              style={{
                width: "100%",
                height: 1,
                background: "#e5e5e5",
                marginBottom: 24,
              }}
            />

            {/* CTA Label */}
            <p
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#000000",
                margin: "0 0 16px 0",
                letterSpacing: "-0.01em",
              }}
            >
              Sign-in to explore my journey
            </p>

            {/* Sign in button */}
            <button
              onClick={() => signIn("google")}
              style={{
                width: "100%",
                background: "#000000",
                color: "#ffffff",
                border: "1px solid #000000",
                padding: "12px 24px",
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                transition: "background 0.15s, color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#ffffff";
                e.currentTarget.style.color = "#000000";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#000000";
                e.currentTarget.style.color = "#ffffff";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.24 10.285V13.4h6.887C18.2 16.3 15.64 18.4 12.24 18.4c-3.53 0-6.4-2.87-6.4-6.4s2.87-6.4 6.4-6.4c1.77 0 3.25.68 4.36 1.73l2.4-2.4C17.55 3.37 15.11 2.4 12.24 2.4 6.96 2.4 2.68 6.68 2.68 12s4.28 9.6 9.56 9.6c5.52 0 9.2-3.88 9.2-9.36 0-.64-.06-1.26-.18-1.955H12.24z" />
              </svg>
              Sign in with Google
            </button>

            {/* Invite-only link */}
            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setShowInviteForm(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#555555",
                  fontSize: 12,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Not on the approved test list? Request an Invite &rarr;
              </button>
            </div>

            {/* Privacy note */}
            <p
              style={{
                fontSize: 11,
                color: "#777777",
                margin: "20px 0 0 0",
                lineHeight: 1.4,
              }}
            >
              Private test environment &bull; Personal memoir & daily recovery logs
            </p>
          </div>
        )}
      </main>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  fontSize: 14,
  border: "1px solid #bbbbbb",
  borderRadius: 4,
  background: "#ffffff",
  color: "#000000",
  fontFamily: "inherit",
};

export default function Home() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "#ffffff" }} />}>
      <HomeContent />
    </Suspense>
  );
}
