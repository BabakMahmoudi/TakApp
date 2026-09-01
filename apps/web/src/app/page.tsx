'use client';

import AuthFlow from '../components/auth-flow';
import HomeDashboard from '../components/home-dashboard';
import { useWallet } from '../lib/wallet-provider';

export default function HomePage() {
  const { session } = useWallet();
  return session ? <HomeDashboard /> : <AuthFlow />;
}
