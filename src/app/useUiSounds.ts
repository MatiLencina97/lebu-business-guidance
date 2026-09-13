'use client';

import { useCallback, useEffect, useRef } from 'react';

const LEBU_SONIC_LOGO = '/sounds/lebu-owl-signature-v2.mp3';

export function useUiSounds(enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const unlockingRef = useRef(false);

  const getAudio = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (audioRef.current) return audioRef.current;

    const audio = new Audio(LEBU_SONIC_LOGO);
    audio.preload = 'auto';
    audio.volume = 0.9;
    audio.setAttribute('playsinline', '');
    audioRef.current = audio;
    return audio;
  }, []);

  const playInternal = useCallback((force = false) => {
    if (!enabled && !force) return;
    const audio = getAudio();
    if (!audio) return;

    // Reiniciar permite que la firma sonora responda inmediatamente a una acción del usuario.
    // MP3 + playsinline es más consistente en Safari/iOS PWA que el WAV anterior.
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Si los metadatos todavía no están listos, play() puede arrancar igualmente desde el inicio.
    }

    void audio.play().catch(() => {
      // Safari/Chrome pueden bloquear audio si no hubo una interacción válida.
      // Nunca dejamos que un sonido afecte el flujo principal de Lebu.
    });
  }, [enabled, getAudio]);

  const play = useCallback(() => playInternal(false), [playInternal]);
  const preview = useCallback(() => playInternal(true), [playInternal]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const removeUnlockListeners = () => {
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
      window.removeEventListener('touchstart', unlockAudio, true);
    };

    function unlockAudio() {
      if (unlockedRef.current) {
        removeUnlockListeners();
        return;
      }
      if (unlockingRef.current) return;
      unlockingRef.current = true;
      const audio = getAudio();
      if (!audio) return;
      const wasMuted = audio.muted;
      audio.muted = true;
      void audio.play().then(() => {
        audio.pause();
        try { audio.currentTime = 0; } catch { /* metadata todavía cargando */ }
        audio.muted = wasMuted;
        unlockedRef.current = true;
        unlockingRef.current = false;
        removeUnlockListeners();
      }).catch(() => {
        audio.muted = wasMuted;
        unlockingRef.current = false;
      });
    }

    window.addEventListener('pointerdown', unlockAudio, true);
    window.addEventListener('keydown', unlockAudio, true);
    window.addEventListener('touchstart', unlockAudio, true);
    return removeUnlockListeners;
  }, [getAudio]);

  useEffect(() => {
    const audio = getAudio();
    audio?.load();
    return () => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    };
  }, [getAudio]);

  return { play, preview };
}
