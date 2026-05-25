import { Helmet } from 'react-helmet-async';

export function SEO({ title, description, url, breadcrumbs, type = 'website', image = '/og-image.png', faqData = null, howToData = null, exactTitle = false }) {
  const siteName = 'Flash File Transfer';
  const fullTitle = exactTitle ? title : (title ? `${title} | ${siteName}` : siteName);
  const defaultDesc = 'Secure, instant browser-to-browser file transfer. No uploads, no storage, just fast P2P sharing. Transfer files directly between devices with end-to-end encryption. Send large files up to 25GB for free without size limits.';
  const metaDesc = description || defaultDesc;
  const canonicalUrl = url ? `https://flash-4n9.pages.dev${url}` : 'https://flash-4n9.pages.dev';
  const imageUrl = `https://flash-4n9.pages.dev${image}`;
  
  // Expanded keywords for SEO
  const keywords = 'file transfer, P2P sharing, secure file sharing, browser to browser, peer to peer, instant transfer, no upload, direct transfer, encrypted file transfer, large file transfer, send files free, share files online, file sharing service, P2P file transfer, WebRTC file transfer, secure file sharing, end-to-end encryption, unlimited file size, fast file transfer, cross-platform file sharing, mobile file transfer, desktop file sharing';

  // JSON-LD structured data for Breadcrumbs if provided
  const breadcrumbSchema = breadcrumbs ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `https://flash-4n9.pages.dev${crumb.path}`
    }))
  } : null;

  // JSON-LD structured data for WebSite/WebPage
  const webPageSchema = {
    '@context': 'https://schema.org',
    '@type': type === 'article' ? 'WebPage' : 'WebSite',
    name: fullTitle,
    description: metaDesc,
    url: canonicalUrl,
    publisher: {
      '@type': 'Organization',
      name: siteName,
      url: 'https://flash-4n9.pages.dev',
      logo: {
        '@type': 'ImageObject',
        url: 'https://flash-4n9.pages.dev/logo.png'
      }
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://flash-4n9.pages.dev/search?q={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  };

  // FAQ Schema for rich snippets
  const faqSchema = faqData ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqData.map(faq => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer
      }
    }))
  } : null;

  // How-to Schema for instructions
  const howToSchema = howToData ? {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: howToData.name,
    description: howToData.description,
    step: howToData.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.name,
      text: step.text,
      image: step.image || undefined
    }))
  } : null;

  return (
    <Helmet>
      {/* Basic Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <meta name="keywords" content={keywords} />
      <meta name="author" content={siteName} />
      <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
      <link rel="canonical" href={canonicalUrl} />
      
      {/* Language and Locale */}
      <html lang="en" />
      <meta name="language" content="English" />
      
      {/* Open Graph Tags */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={siteName} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={siteName} />
      <meta property="og:locale" content="en_US" />
      
      {/* Twitter Card Tags */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@FlashTransfer" />
      <meta name="twitter:creator" content="@FlashTransfer" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDesc} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={siteName} />
      
      {/* Additional Social Meta */}
      <meta name="theme-color" content="#0a0f1c" />
      
      {/* Structured Data */}
      <script type="application/ld+json">
        {JSON.stringify(webPageSchema)}
      </script>
      {breadcrumbSchema && (
        <script type="application/ld+json">
          {JSON.stringify(breadcrumbSchema)}
        </script>
      )}
      {faqSchema && (
        <script type="application/ld+json">
          {JSON.stringify(faqSchema)}
        </script>
      )}
      {howToSchema && (
        <script type="application/ld+json">
          {JSON.stringify(howToSchema)}
        </script>
      )}
    </Helmet>
  );
}
