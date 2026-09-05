'use client';

import { useCallback, useRef } from 'react';
import { trpc } from './trpc/trpc';

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
  return output;
}

export function useEnablePush(): () => Promise<boolean> {
  const utils = trpc.useUtils();
  const subscribeMutation = trpc.push.subscribe.useMutation();
  const mutateRef = useRef(subscribeMutation.mutateAsync);
  mutateRef.current = subscribeMutation.mutateAsync;

  return useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return false;
    }
    try {
      const keyData = await utils.push.publicKey.fetch(undefined);
      const vapidPublicKey = keyData?.vapidPublicKey;
      if (!vapidPublicKey) return false;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
      }
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
      await mutateRef.current({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth });
      return true;
    } catch {
      return false;
    }
  }, [utils]);
}
