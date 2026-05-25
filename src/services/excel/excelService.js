// services/excel/excelService.js
// Uses SheetJS (xlsx) loaded via CDN in popup

export function generateExcel(productData, aiContent) {
  // We'll return a structured object that popup.js uses with SheetJS
  const asin = productData.asin || 'UNKNOWN';
  const brand = productData.brand || '';
  const category = productData.category || '';
  const price = productData.price?.sale || productData.price?.original || '';

  // ── Sheet 1: Parent Product ──────────────────────────────────────────────────
  const parentRows = [
    [
      'ASIN',
      'SEO Title',
      'Subtitle',
      'Brand',
      'Category',
      'eBay Category',
      'Original Price',
      'Sale Price',
      'Stock Status',
      'Rating',
      'Review Count',
      'Amazon URL',
      'Image Folder',
      'Condition',
      'AI Rewritten',
    ],
    [
      asin,
      aiContent?.seoTitle || productData.title || '',
      aiContent?.subtitle || '',
      brand,
      category,
      aiContent?.ebayCategory || '',
      productData.price?.original || '',
      productData.price?.sale || '',
      productData.stock?.status || '',
      productData.rating?.rating || '',
      productData.rating?.count || '',
      productData.url || '',
      asin,
      'New',
      aiContent ? 'Yes' : 'No',
    ],
  ];

  // ── Sheet 2: Variants ────────────────────────────────────────────────────────
  const variantHeaders = ['SKU', 'ASIN', 'Parent ASIN', 'Variant Type', 'Variant Value', 'Price', 'Stock', 'Image Folder', 'Notes'];

  const variantRows = [variantHeaders];

  if (productData.variants && productData.variants.length > 0) {
    productData.variants.forEach((v, i) => {
      const sku = `${asin}-${v.type?.toUpperCase()}-${v.value?.toUpperCase().replace(/\s+/g, '-')}`;
      variantRows.push([
        sku,
        v.asin || '',
        asin,
        v.type || '',
        v.value || '',
        price,
        v.selected ? productData.stock?.quantity || 0 : 0,
        `${asin}/variants/${v.value?.replace(/\s+/g, '-').toUpperCase()}`,
        '',
      ]);
    });
  } else {
    // Single product, no variants
    variantRows.push([
      `${asin}-DEFAULT`,
      asin,
      asin,
      'N/A',
      'Default',
      price,
      productData.stock?.quantity || 0,
      `${asin}/main`,
      '',
    ]);
  }

  // ── Sheet 3: Bullets & Description ───────────────────────────────────────────
  const contentRows = [['Type', 'Content']];

  const bullets = aiContent?.bulletPoints?.length ? aiContent.bulletPoints : productData.bullets || [];
  bullets.forEach((b, i) => contentRows.push([`Bullet ${i + 1}`, b]));

  if (aiContent?.searchTags?.length) {
    contentRows.push(['Search Tags', aiContent.searchTags.join(', ')]);
  }

  contentRows.push(['HTML Description', aiContent?.htmlDescription || productData.description || '']);
  contentRows.push(['Condition Description', aiContent?.conditionDescription || '']);

  // ── Sheet 4: Item Specifics ───────────────────────────────────────────────────
  const specsRows = [['Attribute', 'Value']];

  const specs = {
    ...(productData.itemSpecifics || {}),
    ...(aiContent?.itemSpecifics || {}),
  };

  Object.entries(specs).forEach(([k, v]) => {
    specsRows.push([k, v]);
  });

  return {
    sheets: [
      { name: 'Parent Product', data: parentRows },
      { name: 'Variants', data: variantRows },
      { name: 'Content & Bullets', data: contentRows },
      { name: 'Item Specifics', data: specsRows },
    ],
    filename: `${asin}-product.xlsx`,
  };
}

// Build folder structure metadata for ZIP
export function buildFolderStructure(productData, aiContent) {
  const asin = productData.asin;
  const date = new Date();
  const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const categoryFolder = (productData.category || 'UNCATEGORIZED').split('>')[0].trim().toUpperCase().replace(/\s+/g, '-').substring(0, 20);
  const shortTitle = (productData.title || 'PRODUCT').split(' ').slice(0, 3).join('-').toUpperCase().replace(/[^A-Z0-9-]/g, '');

  return {
    root: `EXPORTS/${monthFolder}/${categoryFolder}/${asin}-${shortTitle}`,
    files: {
      'original-data.json': JSON.stringify(productData, null, 2),
      'seo-content/parent.txt': buildSEOText(productData, aiContent),
      'seo-content/ai-response.json': JSON.stringify(aiContent || {}, null, 2),
      'logs/scrape.log': `Scraped: ${new Date().toISOString()}\nASIN: ${asin}\nVariants: ${productData.variants?.length || 0}\nImages: ${productData.images?.length || 0}`,
    },
    imageFolders: buildImageFolders(productData),
  };
}

function buildSEOText(product, ai) {
  if (!ai) return `Title: ${product.title}\n\nBullets:\n${(product.bullets || []).join('\n')}\n\nDescription:\n${product.description || ''}`;

  return `=== eBay UK SEO LISTING ===

TITLE (${(ai.seoTitle || '').length}/80 chars):
${ai.seoTitle || ''}

SUBTITLE (${(ai.subtitle || '').length}/55 chars):
${ai.subtitle || ''}

eBay CATEGORY:
${ai.ebayCategory || ''}

BULLET POINTS:
${(ai.bulletPoints || []).map((b, i) => `• ${b}`).join('\n')}

SEARCH TAGS:
${(ai.searchTags || []).join(', ')}

ITEM SPECIFICS:
${Object.entries(ai.itemSpecifics || {}).map(([k, v]) => `${k}: ${v}`).join('\n')}

HTML DESCRIPTION:
${ai.htmlDescription || ''}

CONDITION DESCRIPTION:
${ai.conditionDescription || ''}

=== ORIGINAL AMAZON DATA ===
Title: ${product.title}
Brand: ${product.brand}
Category: ${product.category}
`;
}

function buildImageFolders(product) {
  const folders = {};

  // Main images
  if (product.images?.length) {
    folders['images/main'] = product.images;
  }

  // Variant images
  if (product.variants?.length) {
    product.variants.forEach((v) => {
      if (v.image) {
        const folderName = `images/variants/${v.value?.replace(/\s+/g, '-').toUpperCase() || 'UNKNOWN'}`;
        folders[folderName] = [v.image];
      }
    });
  }

  return folders;
}
