// Sunucu bileşenlerinden de okunabilen tema sabitleri ('use client' değil).

export const THEME_STORAGE_KEY = 'theme';

/** <head> içinde ilk boyamadan önce çalışan betik (ekran titremesini önler). */
export const THEME_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='dark'&&t!=='system'&&t!=='light'){t=d.getAttribute('data-theme')||'light'}var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.setAttribute('data-theme',t);d.classList.toggle('dark',dark);d.classList.toggle('light',!dark)}catch(e){}})();`;
