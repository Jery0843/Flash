import { Link } from 'react-router-dom';
import { SEO } from '../components/SEO';
import './Home.css';

export function Home() {
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
      {
        name: "Click Send",
        text: "On the home page, click the 'Send' button to create a new transfer room."
      },
      {
        name: "Select Files",
        text: "Choose the files you want to send. You can select multiple files of any type."
      },
      {
        name: "Share Room Code",
        text: "Flash generates a unique 8-character room code. Share this code with the recipient."
      },
      {
        name: "Recipient Joins",
        text: "The recipient enters the room code on the 'Receive' page to connect."
      },
      {
        name: "Transfer Begins",
        text: "Once connected, files transfer directly between devices with end-to-end encryption."
      }
    ]
  };

  return (
    <div className="home-page">
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

      <div className="home-hero">
        <h1 className="home-title" data-text="FLASH">
          FLASH
        </h1>
        <p className="home-subtitle">
          Secure, instant browser-to-browser file transfer. No uploads, no storage, just fast P2P sharing.
        </p>

        <div className="home-actions">
          <Link to="/create" className="btn btn-primary btn-lg" id="send-file-btn">
            Send Files Free
          </Link>
          <Link to="/join" className="btn btn-secondary btn-lg" id="receive-file-btn">
            Receive Files
          </Link>
        </div>
      </div>

      {/* Features Section */}
      <section className="home-features">
        <h2 className="section-title">Why Choose Flash?</h2>
        <div className="features-grid">
          <div className="feature-card">
            <h3>🔒 End-to-End Encryption</h3>
            <p>Your files never pass through any server. Direct P2P transfer ensures maximum security and privacy.</p>
          </div>
          <div className="feature-card">
            <h3>⚡ Lightning Fast</h3>
            <p>No server bottlenecks. Transfer at maximum speed with direct peer-to-peer WebRTC connections.</p>
          </div>
          <div className="feature-card">
            <h3>📦 Up to 25GB Files</h3>
            <p>Send large files without size limits. Perfect for videos, archives, and large documents.</p>
          </div>
          <div className="feature-card">
            <h3>🌐 Cross-Platform</h3>
            <p>Works on all devices - desktop, mobile, tablet. Windows, Mac, Linux, iOS, Android.</p>
          </div>
          <div className="feature-card">
            <h3>🚫 No Account Required</h3>
            <p>No registration, no login, no personal information. Just open and transfer.</p>
          </div>
          <div className="feature-card">
            <h3>💰 100% Free</h3>
            <p>No subscription fees, no hidden charges. Unlimited transfers, completely free forever.</p>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="home-comparison">
        <h2 className="section-title">How Flash Compares</h2>
        <div className="comparison-table">
          <table>
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
              <tr>
                <td>End-to-End Encryption</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
              </tr>
              <tr>
                <td>No Server Storage</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
                <td className="cross">✗</td>
                <td className="cross">✗</td>
              </tr>
              <tr>
                <td>25GB+ File Support</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
              </tr>
              <tr>
                <td>No Account Required</td>
                <td className="check">✓</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
                <td className="cross">✗</td>
              </tr>
              <tr>
                <td>Completely Free</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
                <td className="cross">✗</td>
                <td className="check">✓</td>
              </tr>
              <tr>
                <td>Direct P2P Transfer</td>
                <td className="check">✓</td>
                <td className="cross">✗</td>
                <td className="cross">✗</td>
                <td className="cross">✗</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="home-faq">
        <h2 className="section-title">Frequently Asked Questions</h2>
        <div className="faq-list">
          {faqData.map((faq, index) => (
            <div key={index} className="faq-item">
              <h3 className="faq-question">{faq.question}</h3>
              <p className="faq-answer">{faq.answer}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="home-testimonials">
        <h2 className="section-title">What Users Say</h2>
        <div className="testimonials-grid">
          <div className="testimonial-card">
            <div className="testimonial-rating">★★★★★</div>
            <p className="testimonial-text">"Fastest file transfer I've ever used. Sent 10GB in minutes without any upload. Amazing!"</p>
            <div className="testimonial-author">
              <span className="testimonial-name">Alex Chen</span>
              <span className="testimonial-role">Software Developer</span>
            </div>
          </div>
          <div className="testimonial-card">
            <div className="testimonial-rating">★★★★★</div>
            <p className="testimonial-text">"Finally a file transfer service that doesn't require an account. Simple, secure, and incredibly fast."</p>
            <div className="testimonial-author">
              <span className="testimonial-name">Sarah Johnson</span>
              <span className="testimonial-role">Digital Designer</span>
            </div>
          </div>
          <div className="testimonial-card">
            <div className="testimonial-rating">★★★★★</div>
            <p className="testimonial-text">"Used it to transfer project files between my Mac and Windows PC. Worked flawlessly."</p>
            <div className="testimonial-author">
              <span className="testimonial-name">Mike Thompson</span>
              <span className="testimonial-role">Project Manager</span>
            </div>
          </div>
        </div>
      </section>

      <div className="home-copyright">
        © 0xJerry
      </div>
    </div>
  );
}
