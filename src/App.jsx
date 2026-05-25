import { useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { CreateRoom } from './pages/CreateRoom';
import { JoinRoom } from './pages/JoinRoom';
import { TransferRoom } from './pages/TransferRoom';
import { ErrorPage } from './pages/ErrorPage';
import { SplashScreen } from './components/SplashScreen';

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  return (
    <>
      <AnimatePresence>
        {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
      </AnimatePresence>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            
            {/* SEO Keyword Landing Pages */}
            <Route path="secure-file-transfer" element={
              <Home 
                seoTitle="Secure File Transfer | End-to-End Encrypted File Sharing | Flash"
                seoDescription="The most secure file transfer for your sensitive data. End-to-end encrypted, browser-based, no server storage. Send files safely and instantly."
                heroTitle="SECURE TRANSFER"
                heroSubtitle="The most secure way to transfer files. Your data is end-to-end encrypted and never stored on any server."
                url="/secure-file-transfer"
              />
            } />
            <Route path="send-large-files" element={
              <Home 
                seoTitle="Send Large Files Free | Share Up To 25GB Instantly | Flash"
                seoDescription="Send large files up to 25GB completely for free. No file size limits, no registration required. The fastest way to share big files online."
                heroTitle="SEND LARGE FILES"
                heroSubtitle="Send massive files up to 25GB completely for free. No limits, no compression, just lightning-fast sharing."
                url="/send-large-files"
              />
            } />
            <Route path="p2p-file-sharing" element={
              <Home 
                seoTitle="P2P File Sharing | Fast Browser-to-Browser Transfer | Flash"
                seoDescription="True peer-to-peer file sharing directly from your browser. Experience maximum speed with direct device-to-device WebRTC connections."
                heroTitle="P2P SHARING"
                heroSubtitle="True peer-to-peer file sharing. Bypass servers entirely and connect directly to the recipient for maximum speed."
                url="/p2p-file-sharing"
              />
            } />
            <Route path="online-file-transfer" element={
              <Home 
                seoTitle="Online File Transfer | Fast & Secure Browser Sharing | Flash"
                seoDescription="The fastest online file transfer tool. Share files directly from your browser without uploading to any server. Free, unlimited, and encrypted."
                heroTitle="ONLINE TRANSFER"
                heroSubtitle="The fastest online file transfer. No uploads, no waiting—just instant sharing straight from your browser."
                url="/online-file-transfer"
              />
            } />
            <Route path="browser-file-transfer" element={
              <Home 
                seoTitle="Browser File Transfer | No Install Direct File Sharing | Flash"
                seoDescription="Transfer files directly through your web browser. No software to install, no extensions needed. Instantly share files across any platform."
                heroTitle="BROWSER TRANSFER"
                heroSubtitle="Share files directly through your web browser. No software to install, works instantly on any device."
                url="/browser-file-transfer"
              />
            } />

            <Route path="create" element={<CreateRoom />} />
            <Route path="join" element={<JoinRoom />} />
            <Route path="room/:roomId" element={<TransferRoom />} />
            <Route path="*" element={<ErrorPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </>
  );
}
