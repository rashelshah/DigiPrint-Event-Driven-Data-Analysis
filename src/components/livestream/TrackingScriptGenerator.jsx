import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../api/supabaseClient';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Unified Tracking Script Generator (site_id based).
 * Step 1: Enter URL and register site.
 * Step 2: Copy script containing data-site-id.
 * Step 3: Start monitoring this specific site.
 */
const TrackingScriptGenerator = ({ onSiteRegistered, onStartMonitoring }) => {
  const [url, setUrl] = useState('');
  const [siteRecord, setSiteRecord] = useState(null);
  const [script, setScript] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const step = isMonitoring ? 3 : script ? 2 : 1;

  const parseDomain = (rawUrl) => {
    let normalized = rawUrl.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    return new URL(normalized).hostname.toLowerCase();
  };

  const createOrFetchUserSite = async (domain) => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user?.id) {
      throw new Error('You must be logged in to register a site.');
    }

    const { data: existing, error: existingError } = await supabase
      .from('sites')
      .select('id, site_name, domain')
      .eq('domain', domain)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }
    if (existing?.id) return existing;

    const { data: inserted, error: insertError } = await supabase
      .from('sites')
      .insert({
        site_name: domain,
        domain,
        is_active: true,
        user_id: user.id,
      })
      .select('id, site_name, domain')
      .single();

    if (insertError) throw insertError;
    return inserted;
  };

  const handleGenerate = async (event) => {
    event.preventDefault();
    setError('');
    setScript('');
    setSiteRecord(null);
    setCopied(false);
    setIsMonitoring(false);

    if (!url.trim()) {
      setError('Please enter a website URL.');
      return;
    }

    let domain;
    try {
      domain = parseDomain(url);
      if (!domain) throw new Error('Invalid URL');
    } catch {
      setError('Invalid URL format.');
      return;
    }

    setLoading(true);
    try {
      const site = await createOrFetchUserSite(domain);
      setSiteRecord(site);

      const trackerUrl = `${window.location.origin}/tracker.js`;
      const snippet = `<script\n  src="${trackerUrl}"\n  data-site-id="${site.id}"\n  data-supabase-url="${SUPABASE_URL}"\n  data-supabase-key="${SUPABASE_ANON_KEY}">\n</script>`;
      setScript(snippet);
      onSiteRegistered?.();
    } catch (err) {
      const message =
        err?.message ||
        'Failed to register site. Please check your Supabase RLS and unique constraints.';
      setError(message);
      console.error('Tracking script generation error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = script;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleStartMonitoring = () => {
    if (!siteRecord) return;
    setIsMonitoring(true);
    onStartMonitoring?.(siteRecord);
  };

  const handleReset = () => {
    setUrl('');
    setScript('');
    setSiteRecord(null);
    setError('');
    setCopied(false);
    setIsMonitoring(false);
    onStartMonitoring?.(null);
  };

  return (
    <motion.div
      className="glass-strong rounded-xl border border-border overflow-hidden"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg">{step === 3 ? 'Live' : 'SDK'}</span>
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {step === 3 ? 'Live Monitoring' : 'Track Your Website'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {step === 1 && 'Enter your website URL to generate a tracking script.'}
              {step === 2 && 'Copy the script and install it in your site head.'}
              {step === 3 &&
                `Monitoring ${siteRecord?.domain || 'site'} (site_id: ${String(siteRecord?.id || '').slice(0, 12)})`}
            </p>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : s < step
                    ? 'bg-primary/30 text-primary'
                    : 'bg-white/10 text-muted-foreground'
              }`}
            >
              {s < step ? 'OK' : s}
            </div>
          ))}
        </div>
      </div>

      {step === 3 && (
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm text-green-400">
              Monitoring:
              {' '}
              <span className="font-mono font-medium">{siteRecord?.domain}</span>
              {' '}
              <span className="text-muted-foreground">(site_id {siteRecord?.id})</span>
            </span>
          </div>
          <button
            onClick={handleReset}
            className="px-4 py-2 glass text-muted-foreground rounded-lg hover:bg-white/10 transition-all text-sm active:scale-95"
          >
            Change Website
          </button>
        </div>
      )}

      {step < 3 && (
        <div className="p-5">
          <form onSubmit={handleGenerate} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError('');
                }}
                placeholder="https://your-website.com"
                disabled={step === 2}
                className="w-full px-4 py-2.5 bg-background border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono text-sm disabled:opacity-50"
              />
              {error && <p className="text-red-400 text-xs mt-1.5">{error}</p>}
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading || step === 2}
                className="px-5 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 border border-border transition-all duration-200 active:scale-95 text-sm whitespace-nowrap disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:cursor-not-allowed"
              >
                {loading ? 'Registering...' : 'Generate Script'}
              </button>
              <button
                type="button"
                onClick={handleStartMonitoring}
                disabled={step !== 2 || !siteRecord}
                className={`px-5 py-2.5 font-medium rounded-lg border border-border transition-all duration-200 active:scale-95 text-sm whitespace-nowrap ${
                  step === 2 && siteRecord
                    ? 'bg-green-500 text-foreground hover:bg-green-400 hover:shadow-[0_0_20px_rgba(34,197,94,0.4)]'
                    : 'bg-secondary text-secondary-foreground opacity-50 cursor-not-allowed'
                }`}
              >
                Start Monitoring
              </button>
            </div>
          </form>
        </div>
      )}

      <AnimatePresence>
        {step === 2 && script && siteRecord && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-sm text-green-400">
                  Site ready:
                  {' '}
                  <span className="font-mono font-medium">{siteRecord.domain}</span>
                  {' '}
                  <span className="text-muted-foreground">(site_id {siteRecord.id})</span>
                </span>
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                  Tracking Script
                </p>
                <span className="text-xs text-muted-foreground">
                  Paste into your {'<head>'} tag
                </span>
              </div>

              <div className="relative group">
                <pre className="bg-card/80 border border-border rounded-lg p-4 overflow-x-auto text-sm font-mono text-primary/80 leading-relaxed">
                  {script}
                </pre>

                <button
                  onClick={handleCopy}
                  className={`absolute top-3 right-3 px-3 py-1.5 rounded-md text-xs font-medium transition-all active:scale-95 ${
                    copied
                      ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                      : 'bg-white/10 text-muted-foreground border border-border hover:bg-white/20 opacity-0 group-hover:opacity-100'
                  }`}
                >
                  {copied ? 'Copied' : 'Copy Script'}
                </button>
              </div>

              <div className="mt-4 glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground font-medium mb-2">How it works:</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Copy the script above.</li>
                  <li>Paste it inside your website {'<head>'} tag.</li>
                  <li>
                    The SDK sends data with this exact <code className="text-primary bg-muted px-1 rounded">site_id</code>.
                  </li>
                </ol>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default TrackingScriptGenerator;
