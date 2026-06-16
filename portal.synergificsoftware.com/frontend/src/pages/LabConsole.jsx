import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import apiCaller from '../services/apiCaller';

const PANEL_BG = '#0b1d3a';
const PANEL_FG = '#e2e8f0';
const ACCENT   = '#3b82f6';

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try { await navigator.clipboard.writeText(value || ''); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {}
  };
  return (
    <button onClick={onClick} title='Copy' style={{
      marginLeft: 6, padding: '2px 8px', fontSize: 12, background: '#1e293b', color: '#cbd5e1',
      border: '1px solid #334155', borderRadius: 4, cursor: 'pointer'
    }}>{copied ? '✓' : 'Copy'}</button>
  );
}

function Countdown({ leftSec }) {
  const [s, setS] = useState(leftSec || 0);
  useEffect(() => { setS(leftSec || 0); }, [leftSec]);
  useEffect(() => {
    const id = setInterval(() => setS(prev => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const fmt = n => String(n).padStart(2, '0');
  return <span style={{ fontFamily: 'monospace', fontSize: 16 }}>{fmt(h)}:{fmt(m)}:{fmt(sec)}</span>;
}

function Section({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #1e293b' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', background: 'transparent', color: PANEL_FG, border: 'none',
        cursor: 'pointer', fontSize: 13, fontWeight: 600
      }}>
        <span>{icon} {title}</span>
        <span style={{ opacity: 0.6 }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '4px 16px 14px', fontSize: 13 }}>{children}</div>}
    </div>
  );
}

function CredField({ label, value, isPassword }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <input
          type={isPassword && !show ? 'password' : 'text'}
          value={value || ''}
          readOnly
          style={{
            flex: 1, padding: '5px 8px', fontSize: 12, background: '#0f172a',
            color: '#e2e8f0', border: '1px solid #1e293b', borderRadius: 4, outline: 'none'
          }}
        />
        {isPassword && (
          <button onClick={() => setShow(!show)} style={{
            marginLeft: 6, padding: '2px 8px', fontSize: 11, background: '#1e293b',
            color: '#cbd5e1', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer'
          }}>{show ? 'Hide' : 'Show'}</button>
        )}
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export default function LabConsole() {
  const { vmName } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('HOME');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const notesTimer = useRef(null);
  const iframeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiCaller.get('/lab/session/' + encodeURIComponent(vmName));
        if (!alive) return;
        setData(res.data);
        setNotes(res.data?.vm?.notes || '');
      } catch (e) {
        setError(e?.response?.data?.message || e.message);
      }
    })();
    return () => { alive = false; };
  }, [vmName]);

  const saveNotes = useCallback(async (val) => {
    setSaving(true);
    try { await apiCaller.post('/lab/session/' + encodeURIComponent(vmName) + '/notes', { notes: val }); }
    catch {} finally { setSaving(false); }
  }, [vmName]);

  const onNotesChange = e => {
    const v = e.target.value;
    setNotes(v);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => saveNotes(v), 1200);
  };

  const onEndLab = async () => {
    if (!confirm('End this lab? The VM will stop and you will return to your VM list.')) return;
    try {
      await apiCaller.post('/lab/session/' + encodeURIComponent(vmName) + '/end');
      navigate('/vm/vmdetails');
    } catch (e) { alert(e?.response?.data?.message || e.message); }
  };

  const reloadIframe = () => {
    if (iframeRef.current && data?.accessUrl) iframeRef.current.src = data.accessUrl;
  };

  if (error) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading lab…</div>;

  const { vm, creds, timer, guide, accessUrl, prerequisites } = data;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#020617', fontFamily: 'Segoe UI, Tahoma, sans-serif' }}>
      {/* LEFT SIDE PANEL */}
      <aside style={{ width: 320, background: PANEL_BG, color: PANEL_FG, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1e293b' }}>
        <div style={{ padding: '14px 18px', background: 'linear-gradient(90deg,#0f172a,#1d4ed8)' }}>
          <div style={{ fontSize: 11, opacity: 0.85, letterSpacing: 1 }}>HEXALABS LAB CONSOLE</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{guide?.title || vm.templateName || 'Lab'}</div>
        </div>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #1e293b' }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>⏱ Time remaining</span>
          <Countdown leftSec={timer?.leftSec} />
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
          {['HOME', 'GUIDE'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px 0', background: tab === t ? '#1e293b' : 'transparent',
              color: tab === t ? '#fff' : '#94a3b8', border: 'none',
              borderBottom: tab === t ? '2px solid ' + ACCENT : '2px solid transparent',
              fontSize: 12, fontWeight: 600, letterSpacing: 0.5, cursor: 'pointer'
            }}>{t}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'HOME' && (
            <>
              <Section title='Virtual machine' icon='🖥'>
                <div style={{ marginBottom: 10, color: '#cbd5e1', fontSize: 12 }}>{vm.name}</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <button onClick={reloadIframe} style={{ flex: 1, padding: '6px 0', fontSize: 11, background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Reconnect</button>
                  <a href={accessUrl} target='_blank' rel='noopener noreferrer' style={{ flex: 1, padding: '6px 0', fontSize: 11, background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 4, textAlign: 'center', textDecoration: 'none' }}>Pop-out</a>
                </div>
                <CredField label='VM Username' value={creds?.vm?.username} />
                <CredField label='VM Password' value={creds?.vm?.password} isPassword />
              </Section>
              <Section title='Portal credentials' icon='🔐' defaultOpen={false}>
                <CredField label='Portal Username' value={creds?.portal?.username} />
                <CredField label='Portal Password' value={creds?.portal?.password} isPassword />
              </Section>
              <Section title='Status' icon='✓'>
                <div style={{ display: 'inline-block', padding: '3px 10px', background: prerequisites?.status === 'Successfully Deployed' ? '#16a34a' : '#ca8a04', color: '#fff', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                  {prerequisites?.status}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>Public IP: <span style={{ color: '#cbd5e1' }}>{vm.publicIp || '-'}</span></div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>Org: <span style={{ color: '#cbd5e1' }}>{vm.organization}</span></div>
              </Section>
              <Section title='Notes' icon='📝'>
                <textarea
                  value={notes}
                  onChange={onNotesChange}
                  rows={5}
                  placeholder='Auto-saves as you type…'
                  style={{ width: '100%', padding: 8, fontSize: 12, background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e293b', borderRadius: 4, resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{saving ? 'Saving…' : 'Saved'}</div>
              </Section>
            </>
          )}
          {tab === 'GUIDE' && (
            <div style={{ padding: '14px 16px' }}>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 14, lineHeight: 1.5 }}>{guide?.summary}</div>
              {guide?.sections?.length ? (
                <ol style={{ padding: 0, margin: 0, listStyle: 'none' }}>
                  {guide.sections.map(s => (
                    <li key={s.num} style={{ padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
                      <div style={{ fontSize: 12, color: ACCENT, fontWeight: 600 }}>Module {s.num} — {s.title}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{s.note}</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Full step-by-step guide is on the VM Desktop — click <strong>Syntex Lab Guide</strong>.</div>
              )}
              {guide?.inVmPath && (
                <div style={{ marginTop: 14, padding: 10, background: '#1e293b', borderRadius: 4, fontSize: 11, color: '#cbd5e1' }}>
                  <strong>Live walk-through on VM:</strong><br />
                  Open <code>{guide.inVmPath}</code> in Edge on the VM.
                </div>
              )}
            </div>
          )}
        </div>
        <button onClick={onEndLab} style={{ padding: '14px 18px', background: '#dc2626', color: '#fff', border: 'none', fontWeight: 600, fontSize: 13, letterSpacing: 0.5, cursor: 'pointer' }}>
          END THIS LAB
        </button>
      </aside>
      {/* RIGHT VM PANE */}
      <main style={{ flex: 1, background: '#000', position: 'relative' }}>
        {accessUrl ? (
          <iframe ref={iframeRef} src={accessUrl} title='VM' style={{ width: '100%', height: '100%', border: 'none' }} allow='clipboard-read; clipboard-write' />
        ) : (
          <div style={{ color: '#94a3b8', padding: 40, fontFamily: 'system-ui' }}>VM access URL not available — VM may be stopped. Start it from the VM list.</div>
        )}
      </main>
    </div>
  );
}
