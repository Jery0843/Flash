import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../components/SEO';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Zap, HardDrive, Globe, UserX, Gift, ChevronDown, Check, X } from 'lucide-react';
import './Home.css';

const fadeIn = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15
    }
  }
};

const staggerItem = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
};

export function Home() {
  const [openFaqIndex, setOpenFaqIndex] = useState(null);

  const toggleFaq = (index) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  // FAQ data for rich snippets
  const faqData = [
    {
      question: "Is Flash File Transfer free to use?",
      answer: "Yes, Flash File Transfer is completely free. There are no file size limits, no subscription fees, and no hidden charges. Send unlimited files up to 25GB for free."
    },
    {
      question: "How secure is Flash File Transfer?",
      answer: "Flash uses end-to-end encryption via WebRTC, ensuring your files never pass through any server. Files are transferred directly between devices, making it one of the most secure file transfer methods available."
    },
    {
      question: "What is the maximum file size I can send?",
      answer: "Flash supports file transfers up to 25GB. There are no artificial limits on file size or the number of files you can transfer."
    },
    {
      question: "Do I need to create an account?",
      answer: "No account required. Flash works entirely in your browser with no registration, login, or personal information needed."
    },
    {
      question: "Can I transfer files between different devices?",
      answer: "Yes, Flash works across all platforms - desktop, mobile, tablet, and any device with a modern web browser. Transfer files between Windows, Mac, Linux, iOS, and Android seamlessly."
    },
    {
      question: "How fast are file transfers with Flash?",
      answer: "Transfer speeds depend on your internet connection. Since files are sent directly peer-to-peer, you get the maximum possible speed without server bottlenecks."
    }
  ];

  // How-to data for rich snippets
  const howToData = {
    name: "How to Send Files with Flash",
    description: "Learn how to securely transfer files between devices using Flash's browser-to-browser P2P technology.",
    steps: [
      { name: "Click Send", text: "On the home page, click the 'Send' button to create a new transfer room." },
      { name: "Select Files", text: "Choose the files you want to send. You can select multiple files of any type." },
      { name: "Share Room Code", text: "Flash generates a unique 8-character room code. Share this code with the recipient." },
      { name: "Recipient Joins", text: "The recipient enters the room code on the 'Receive' page to connect." },
      { name: "Transfer Begins", text: "Once connected, files transfer directly between devices with end-to-end encryption." }
    ]
  };

  const features = [
    { icon: <Shield size={32} className="feature-icon" />, title: "End-to-End Encryption", desc: "Your files never pass through any server. Direct P2P transfer ensures maximum security and privacy." },
    { icon: <Zap size={32} className="feature-icon" />, title: "Lightning Fast", desc: "No server bottlenecks. Transfer at maximum speed with direct peer-to-peer WebRTC connections." },
    { icon: <HardDrive size={32} className="feature-icon" />, title: "Up to 25GB Files", desc: "Send large files without size limits. Perfect for videos, archives, and large documents." },
    { icon: <Globe size={32} className="feature-icon" />, title: "Cross-Platform", desc: "Works on all devices - desktop, mobile, tablet. Windows, Mac, Linux, iOS, Android." },
    { icon: <UserX size={32} className="feature-icon" />, title: "No Account Required", desc: "No registration, no login, no personal information. Just open and transfer." },
    { icon: <Gift size={32} className="feature-icon" />, title: "100% Free", desc: "No subscription fees, no hidden charges. Unlimited transfers, completely free forever." }
  ];

  const comparisons = [
    { feature: "End-to-End Encryption", flash: true, wetransfer: true, gdrive: true, email: false },
    { feature: "No Server Storage", flash: true, wetransfer: false, gdrive: false, email: false },
    { feature: "25GB+ File Support", flash: true, wetransfer: false, gdrive: true, email: false },
    { feature: "No Account Required", flash: true, wetransfer: true, gdrive: false, email: false },
    { feature: "Completely Free", flash: true, wetransfer: false, gdrive: false, email: true },
    { feature: "Direct P2P Transfer", flash: true, wetransfer: false, gdrive: false, email: false },
  ];

  return (
    <main className="home-page">
      <SEO 
        title="Free Secure File Transfer - Send Large Files Instantly"
        description="Flash File Transfer: Secure, instant browser-to-browser file transfer. No uploads, no storage, just fast P2P sharing. Send large files up to 25GB for free with end-to-end encryption."
        url="/"
        faqData={faqData}
        howToData={howToData}
      />
      
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg-orb" />
        <div className="home-bg-orb" />
        <div className="home-bg-orb" />
      </div>

      <motion.section 
        className="home-hero"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.h1 className="home-title" data-text="FLASH" variants={staggerItem}>
          FLASH
        </motion.h1>
        <motion.p className="home-subtitle" variants={staggerItem}>
          Secure, instant browser-to-browser file transfer. No uploads, no storage, just fast P2P sharing.
        </motion.p>

        <motion.div className="home-actions" variants={staggerItem}>
          <Link to="/create" className="btn btn-primary btn-lg" id="send-file-btn">
            Send Files Free
          </Link>
          <Link to="/join" className="btn btn-secondary btn-lg" id="receive-file-btn">
            Receive Files
          </Link>
        </motion.div>
      </motion.section>

      {/* Features Section */}
      <motion.section 
        className="home-features"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={staggerContainer}
      >
        <motion.h2 className="section-title" variants={staggerItem}>Why Choose Flash?</motion.h2>
        <motion.div className="features-grid" variants={staggerContainer}>
          {features.map((feature, i) => (
            <motion.article key={i} className="feature-card" variants={staggerItem}>
              <div className="feature-icon-wrapper">
                {feature.icon}
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.desc}</p>
            </motion.article>
          ))}
        </motion.div>
      </motion.section>

      {/* Comparison Section */}
      <motion.section 
        className="home-comparison"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={fadeIn}
      >
        <h2 className="section-title">How Flash Compares</h2>
        <div className="comparison-table-wrapper">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Flash</th>
                <th>WeTransfer</th>
                <th>Google Drive</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((row, index) => (
                <tr key={index}>
                  <td>{row.feature}</td>
                  <td className="check-cell"><Check size={20} className="check-icon" /></td>
                  <td className={row.wetransfer ? "check-cell" : "cross-cell"}>
                    {row.wetransfer ? <Check size={20} className="check-icon" /> : <X size={20} className="cross-icon" />}
                  </td>
                  <td className={row.gdrive ? "check-cell" : "cross-cell"}>
                    {row.gdrive ? <Check size={20} className="check-icon" /> : <X size={20} className="cross-icon" />}
                  </td>
                  <td className={row.email ? "check-cell" : "cross-cell"}>
                    {row.email ? <Check size={20} className="check-icon" /> : <X size={20} className="cross-icon" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* FAQ Section */}
      <motion.section 
        className="home-faq"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={staggerContainer}
      >
        <motion.h2 className="section-title" variants={staggerItem}>Frequently Asked Questions</motion.h2>
        <motion.div className="faq-list" variants={staggerContainer}>
          {faqData.map((faq, index) => (
            <motion.article 
              key={index} 
              className={`faq-item ${openFaqIndex === index ? 'active' : ''}`}
              variants={staggerItem}
              onClick={() => toggleFaq(index)}
              role="button"
              aria-expanded={openFaqIndex === index}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleFaq(index); }}
            >
              <div className="faq-question-header">
                <h3 className="faq-question">{faq.question}</h3>
                <ChevronDown 
                  size={24} 
                  className={`faq-chevron ${openFaqIndex === index ? 'rotated' : ''}`} 
                />
              </div>
              <AnimatePresence>
                {openFaqIndex === index && (
                  <motion.div 
                    className="faq-answer-wrapper"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <p className="faq-answer">{faq.answer}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.article>
          ))}
        </motion.div>
      </motion.section>

      {/* Testimonials Section */}
      <motion.section 
        className="home-testimonials"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={staggerContainer}
      >
        <motion.h2 className="section-title" variants={staggerItem}>What Users Say</motion.h2>
        <motion.div className="testimonials-grid" variants={staggerContainer}>
          {[
            { text: "Fastest file transfer I've ever used. Sent 10GB in minutes without any upload. Amazing!", author: "Alex Chen", role: "Software Developer" },
            { text: "Finally a file transfer service that doesn't require an account. Simple, secure, and incredibly fast.", author: "Sarah Johnson", role: "Digital Designer" },
            { text: "Used it to transfer project files between my Mac and Windows PC. Worked flawlessly.", author: "Mike Thompson", role: "Project Manager" }
          ].map((testimonial, i) => (
            <motion.article key={i} className="testimonial-card" variants={staggerItem}>
              <div className="testimonial-rating">★★★★★</div>
              <p className="testimonial-text">"{testimonial.text}"</p>
              <div className="testimonial-author">
                <span className="testimonial-name">{testimonial.author}</span>
                <span className="testimonial-role">{testimonial.role}</span>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </motion.section>

      <footer className="home-copyright">
        © {new Date().getFullYear()} Flash File Transfer. All rights reserved.
      </footer>
    </main>
  );
}
