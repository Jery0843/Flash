import { Helmet } from 'react-helmet-async';

export function SEO({ title, description, url, breadcrumbs }) {
  const siteName = 'Flash File Transfer';
  const fullTitle = title ? `${title} | ${siteName}` : siteName;
  const defaultDesc = 'Secure, instant browser-to-browser file transfer. No uploads, no storage, just fast P2P sharing.';
  const metaDesc = description || defaultDesc;
  const canonicalUrl = url ? `https://flash-4n9.pages.dev${url}` : 'https://flash-4n9.pages.dev';
  
  // JSON-LD structured data for Breadcrumbs if provided
  const schemaOrgJSONLD = breadcrumbs ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `https://flash-4n9.pages.dev${crumb.path}`
    }))
  } : null;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={metaDesc} />
      <link rel="canonical" href={canonicalUrl} />
      
      {/* Open Graph Tags */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDesc} />
      <meta property="og:url" content={canonicalUrl} />
      
      {/* Twitter Tags */}
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDesc} />
      
      {/* Structured Data */}
      {schemaOrgJSONLD && (
        <script type="application/ld+json">
          {JSON.stringify(schemaOrgJSONLD)}
        </script>
      )}
    </Helmet>
  );
}
