'use client';

// Canlı ekran sesleri (04 §4.1, §4.5): Web Audio ile üretilen tonlar (ses dosyası gerekmez).
// Tarayıcı jest olmadan ses çalmaz → "Vardiyayı başlat" dokunuşunda unlock(). Birden çok sekmede yalnız lider sekme
// çalar (Web Locks); kilit yoksa her sekme lider sayılır.

type Level = 'normal' | 'high';
type Listener = () => void;

class AlarmSound {
  private ctx: AudioContext | null = null;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private level: Level = 'normal';
  private leader = false;
  private leaderRequested = false;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Ses bağlamı çalışıyor mu (kilit açık). */
  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  get looping(): boolean {
    return this.loopTimer != null;
  }

  private requestLeadership() {
    if (this.leaderRequested || typeof navigator === 'undefined') return;
    this.leaderRequested = true;
    const locks = (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<void>) => Promise<void> } }).locks;
    if (!locks?.request) {
      this.leader = true;
      return;
    }
    void locks
      .request('siparisinonunde-alarm-leader', () => {
        this.leader = true;
        this.emit();
        return new Promise<void>(() => undefined);
      })
      .catch(() => {
        this.leader = true;
      });
  }

  /** Kullanıcı jesti içinde çağrılmalı: bağlamı açar ve kısa test sesi çalar. */
  async unlock(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    this.requestLeadership();
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.ctx.onstatechange = () => this.emit();
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.tone(880, 0.12, 0.35, 0);
      this.tone(1320, 0.16, 0.35, 0.14);
      this.emit();
      return this.unlocked;
    } catch {
      this.emit();
      return false;
    }
  }

  private tone(freq: number, duration: number, volume: number, delay: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  /** Kısa "ding" (mutfak: yeni onaylanan; hatırlatma). */
  ding(volume = 0.4) {
    if (!this.leader) return;
    this.tone(988, 0.18, volume, 0);
    this.tone(1319, 0.25, volume * 0.8, 0.16);
  }

  private pattern() {
    if (!this.leader) return;
    const high = this.level === 'high';
    const vol = high ? 0.9 : 0.55;
    const base = high ? 1046 : 880;
    for (let i = 0; i < 3; i++) this.tone(base + i * 130, 0.16, vol, i * 0.22, high ? 'square' : 'triangle');
  }

  /** Döngüsel yeni sipariş alarmı; 'high' = 60 sn sonrası yükselen ses (00 §10). */
  startLoop(level: Level) {
    const changed = level !== this.level;
    this.level = level;
    if (this.loopTimer && !changed) return;
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.pattern();
    this.loopTimer = setInterval(() => this.pattern(), level === 'high' ? 1500 : 2400);
  }

  stopLoop() {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
  }
}

export const alarmSound = new AlarmSound();

/** Ekranın kapanmasını engeller (Wake Lock); sekme görünür olunca yeniden istenir. */
export class ScreenWake {
  private sentinel: { release: () => Promise<void>; released?: boolean } | null = null;
  private wanted = false;
  active = false;
  private onVisible = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  async enable(): Promise<boolean> {
    this.wanted = true;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    return this.acquire();
  }

  private async acquire(): Promise<boolean> {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (!wl) return false;
      this.sentinel = await wl.request('screen');
      this.active = true;
      return true;
    } catch {
      this.active = false;
      return false;
    }
  }

  disable() {
    this.wanted = false;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
    this.active = false;
  }
}
