import { trpc } from "@/lib/trpc";
import { ArrowLeft, ArrowRight, Home, LockKeyhole, Mic, Sparkles, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const demoAccounts = [
  { username: "child1", role: "Child", title: "Continue as Child", copy: "Stories, kind coaching, and a progress trail made just for Amina.", accent: "sky", Icon: Mic },
  { username: "teacher2", role: "Teacher", title: "Continue as Teacher", copy: "Review reading moments, share feedback, and create engaging activities.", accent: "mint", Icon: UsersRound },
  { username: "parent3", role: "Parent", title: "Continue as Parent", copy: "Celebrate small wins and plan five friendly reading minutes together.", accent: "coral", Icon: Home },
] as const;

export function DemoLoginLanding() {
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [activeAccount, setActiveAccount] = useState<(typeof demoAccounts)[number] | null>(() => {
    const role = window.sessionStorage.getItem("reader-leader-switch-role");
    return demoAccounts.find(account => account.role.toLowerCase() === role) ?? null;
  });
  const [password, setPassword] = useState("");
  const login = trpc.demoAccess.login.useMutation({
    onSuccess: () => { window.sessionStorage.removeItem("reader-leader-switch-role"); window.location.assign("/"); },
    onError: error => { setBusyAccount(null); toast(error.message || "That demo account could not be opened."); },
  });
  const enterDemo = () => {
    if (!activeAccount) return;
    if (!password) return toast("Enter the demo password to continue.");
    setBusyAccount(activeAccount.username);
    login.mutate({ username: activeAccount.username, password });
  };

  return <main className="portal-page"><div className="portal-orb portal-orb-one" /><div className="portal-orb portal-orb-two" /><section className={`portal-shell ${activeAccount ? "signing-in" : ""}`}><div className="portal-brand"><span className="portal-brand-mark"><span /></span><strong>Reader Leader</strong><small>READ · GROW · LEAD</small></div>{activeAccount ? <section className={`demo-password-card ${activeAccount.accent}`}><button className="back-role-choice pressable" type="button" onClick={() => { window.sessionStorage.removeItem("reader-leader-switch-role"); setActiveAccount(null); setPassword(""); }}><ArrowLeft size={16} /> Choose another role</button><div className="role-badge"><activeAccount.Icon size={32} strokeWidth={2.4} /></div><div className="portal-role">{activeAccount.role} demo</div><h1>Welcome back.</h1><p>Enter the demo password to open the private {activeAccount.role.toLowerCase()} reading space.</p><form className="demo-password-form" onSubmit={event => { event.preventDefault(); enterDemo(); }}><label>Demo password<input type="password" autoFocus value={password} onChange={event => setPassword(event.target.value)} placeholder="Enter password" autoComplete="current-password" /></label><button className="pressable" type="submit" disabled={busyAccount !== null}>{busyAccount ? "Opening your space…" : <>Open my reading space <ArrowRight size={16} /></>}</button></form><p className="demo-account-note"><LockKeyhole size={14} /> Username: <b>{activeAccount.username}</b> · Password: <b>readerleader</b></p></section> : <><div className="portal-intro"><div className="portal-kicker"><Sparkles size={14} /> Welcome to your reading space</div><h1>Let’s make reading<br /><em>feel brilliant.</em></h1><p>Pick a demo account to explore the right Reader Leader space. Each card opens a private, role-aware view—no Google account needed.</p></div><div className="portal-cards">{demoAccounts.map(account => <article className={`portal-card ${account.accent}`} key={account.username}><div className="role-badge"><account.Icon size={30} strokeWidth={2.4} /></div><div><span className="portal-role">{account.role} demo</span><h2>{account.role}</h2><p>{account.copy}</p></div><div className="credential-chip"><LockKeyhole size={13} /><span>Demo username: <b>{account.username}</b></span></div><button className="pressable" onClick={() => { setActiveAccount(account); setPassword(""); }} disabled={busyAccount !== null}><span>{account.title}</span><ArrowRight size={18} /></button></article>)}</div><p className="portal-foot"><LockKeyhole size={14} /> <strong>Demo-only access.</strong> These local accounts contain sample learning records and are not for real pupils or production use.</p></>}</section></main>;
}
