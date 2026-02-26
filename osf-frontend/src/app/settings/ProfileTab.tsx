'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';

const AVATAR_COLORS = [
  '#ff9500', '#ff5722', '#e91e63', '#9c27b0', '#673ab7',
  '#3f51b5', '#2196f3', '#00bcd4', '#009688', '#4caf50',
];

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  return email[0].toUpperCase();
}

function Avatar({ avatar, name, email, size = 80 }: { avatar?: string | null; name: string | null; email: string; size?: number }) {
  const color = avatar?.startsWith('#') ? avatar : AVATAR_COLORS[0];
  const initials = getInitials(name, email);
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-bg shrink-0"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

function Msg({ msg }: { msg: { type: 'success' | 'error'; text: string } | null }) {
  if (!msg) return null;
  return <p className={`text-sm mt-3 ${msg.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>;
}

export function ProfileTab({ user }: { user: any }) {
  const [name, setName] = useState(user.name || '');
  const [avatarColor, setAvatarColor] = useState(user.avatar || AVATAR_COLORS[0]);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [emailPw, setEmailPw] = useState('');
  const [emailMsg, setEmailMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  const saveProfile = async () => {
    setSavingProfile(true); setProfileMsg(null);
    try {
      await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify({ name, avatar: avatarColor }) });
      setProfileMsg({ type: 'success', text: 'Profile updated' });
    } catch (e: any) {
      setProfileMsg({ type: 'error', text: e.message });
    } finally { setSavingProfile(false); }
  };

  const changePw = async () => {
    if (newPw !== confirmPw) { setPwMsg({ type: 'error', text: 'Passwords do not match' }); return; }
    setSavingPw(true); setPwMsg(null);
    try {
      await apiFetch('/auth/profile/password', { method: 'PUT', body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }) });
      setPwMsg({ type: 'success', text: 'Password changed' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) {
      setPwMsg({ type: 'error', text: e.message });
    } finally { setSavingPw(false); }
  };

  const changeEmail = async () => {
    setSavingEmail(true); setEmailMsg(null);
    try {
      const res = await apiFetch<{ message: string }>('/auth/profile/email', { method: 'PUT', body: JSON.stringify({ newEmail, password: emailPw }) });
      setEmailMsg({ type: 'success', text: res.message });
      setNewEmail(''); setEmailPw('');
    } catch (e: any) {
      setEmailMsg({ type: 'error', text: e.message });
    } finally { setSavingEmail(false); }
  };

  return (
    <div className="space-y-10">
      {/* Avatar & Name */}
      <section className="border border-border rounded-md p-6">
        <h2 className="text-text font-semibold mb-5">Profile</h2>
        <div className="flex items-start gap-6">
          <Avatar avatar={avatarColor} name={name || user.name} email={user.email} size={80} />
          <div className="flex-1 space-y-4">
            <div>
              <label className="text-text text-sm font-medium block mb-1.5">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="text-text text-sm font-medium block mb-1.5">Avatar Color</label>
              <div className="flex gap-2 flex-wrap">
                {AVATAR_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setAvatarColor(c)}
                    className={`w-8 h-8 rounded-full transition-transform ${avatarColor === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={saveProfile} disabled={savingProfile} className="bg-accent text-bg px-5 py-2 rounded-sm text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </button>
              <Msg msg={profileMsg} />
            </div>
          </div>
        </div>
        <p className="text-text-dim text-xs mt-4">Email: {user.email} &middot; Tier: {user.tier} &middot; Member since {new Date(user.created_at).toLocaleDateString('de-DE')}</p>
      </section>

      {/* Change Password */}
      <section className="border border-border rounded-md p-6">
        <h2 className="text-text font-semibold mb-5">Change Password</h2>
        <div className="space-y-3 max-w-sm">
          <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Current password"
            className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New password (min 8 chars)"
            className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
          <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Confirm new password"
            className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
          <button onClick={changePw} disabled={savingPw || !currentPw || !newPw || !confirmPw}
            className="bg-accent text-bg px-5 py-2 rounded-sm text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">
            {savingPw ? 'Changing...' : 'Change Password'}
          </button>
          <Msg msg={pwMsg} />
        </div>
      </section>

      {/* Change Email */}
      <section className="border border-border rounded-md p-6">
        <h2 className="text-text font-semibold mb-5">Change Email</h2>
        <p className="text-text-dim text-sm mb-4">A verification email will be sent to your new address.</p>
        <div className="space-y-3 max-w-sm">
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="New email address"
            className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
          <input type="password" value={emailPw} onChange={e => setEmailPw(e.target.value)} placeholder="Current password (to confirm)"
            className="w-full bg-bg-surface border border-border rounded-sm px-3 py-2.5 text-text text-sm focus:outline-none focus:border-accent" />
          <button onClick={changeEmail} disabled={savingEmail || !newEmail || !emailPw}
            className="bg-accent text-bg px-5 py-2 rounded-sm text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50">
            {savingEmail ? 'Updating...' : 'Change Email'}
          </button>
          <Msg msg={emailMsg} />
        </div>
      </section>
    </div>
  );
}
