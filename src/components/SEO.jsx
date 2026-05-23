import { Helmet } from 'react-helmet-async';

export function SEO({ title, description, url, breadcrumbs, type = 'website', image = '/og-image.png' }) {
  const siteName = 'Flash File Transfer';
  const fullTitle = title ? `${title} | ${siteName}` : siteName;
  const defaultDesc = 'Secure, instant browser-to-browser file transfer. No uploads, no storage, just fast P2P sharing. Transfer files directly between devices with end-to-end encryption.';
  const metaDesc = description || defaultDesc;
  const canonicalUrl = url ? `https://flash-4n9.pages.dev${url}` : 'https://flash-4n9.pages.dev';
  const imageUrl = `https://flash-4n9.pages.dev${image}`;
  
  // Keywords for SEO
  const keywords = 'file transfer, P2P sharing, secure file sharing, browser to browser, peer to peer, instant transfer, no upload, direct transfer, encrypted file transfer';

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
      url: 'https://flash-4n9.pages.dev'
    }
  };

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
    </Helmet>
  );
}
