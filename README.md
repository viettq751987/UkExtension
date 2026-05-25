# UK Listing Optimizer — Chrome Extension

> Scrape Amazon UK products → AI SEO rewrite → Export eBay UK package

---

## Features

- **Scrapes** product title, images, variants (colour/size/style), price, stock, bullets, description, item specifics
- **AI rewrites** using OpenRouter (DeepSeek V3, Claude Sonnet, GPT-4.1 Mini, Gemini 2.5 Flash)
- **Generates** Excel workbook (Parent / Variants / SEO Content / Item Specifics sheets)
- **Downloads** all product & variant images upgraded to max resolution
- **Packages** everything into a clean ZIP with proper folder structure

---

## Installation

1. **Clone / Download** this folder
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer Mode** (top right toggle)
4. Click **Load unpacked**
5. Select this folder (`uk-listing-optimizer/`)
6. The ⚡ icon appears in your toolbar

---

## Setup

1. Click the ⚡ extension icon
2. Click ⚙ Settings
3. Paste your **OpenRouter API key** (get one at [openrouter.ai/keys](https://openrouter.ai/keys))
4. Select your preferred AI model
5. Click **Save Settings**

### Getting an OpenRouter Key (Free Tier Available)
- Sign up at [openrouter.ai](https://openrouter.ai)
- Models like DeepSeek V3 cost ~$0.001 per product rewrite
- Claude Sonnet costs ~$0.01 per rewrite but gives best SEO output

---

## Usage

1. Go to any **Amazon UK product page** (`amazon.co.uk/dp/...`)
2. Click the ⚡ extension icon
3. Product is auto-detected with variant count
4. Select export options:
   - ✓ Download Images
   - ✓ AI SEO Rewrite
   - ✓ Generate Excel
   - ✓ Package as ZIP
5. Choose AI model (DeepSeek V3 recommended for cost)
6. Click **▶ START EXPORT**
7. Wait for all steps to complete
8. Click **⬇ Download ZIP**

---

## Export Structure

```
EXPORTS/
└── 2026-05/
    └── HOME-KITCHEN/
        └── B0FG1234-AIR-FRYER-NINJA/
            ├── product.xlsx          ← 4 sheets: Parent, Variants, SEO, Specs
            ├── original-data.json    ← Raw scraped data
            ├── seo-content/
            │   ├── ebay-listing.txt  ← Full eBay listing text
            │   └── ai-result.json    ← Raw AI response
            ├── images/
            │   ├── main/             ← Main product images (max resolution)
            │   │   ├── main.jpg
            │   │   ├── 1.jpg
            │   │   └── ...
            │   └── variants/
            │       ├── BLACK/
            │       ├── RED/
            │       └── ...
            └── logs/
                └── export.log
```

---

## Excel Structure

### Sheet 1: Parent Product
| ASIN | SEO Title | Subtitle | Brand | Category | eBay Category | Prices | Stock | ... |

### Sheet 2: Variants
| SKU | Parent ASIN | Variant Type | Variant Value | Price | Stock | Image Path |

### Sheet 3: SEO Content
| Type | Content |
- Bullet 1-5 (AI rewritten)
- Search Tags
- HTML Description
- Condition Description

### Sheet 4: Item Specifics
| Attribute | Value |
- All Amazon + AI-generated item specifics

---

## AI Models

| Model | Quality | Cost | Speed |
|-------|---------|------|-------|
| DeepSeek V3 | Good | ~$0.001 | Fast |
| Claude Sonnet 4.5 | Best | ~$0.01 | Medium |
| GPT-4.1 Mini | Good | ~$0.002 | Fast |
| Gemini 2.5 Flash | Good | ~$0.001 | Very Fast |
| Claude Haiku | Good | ~$0.003 | Fast |

---

## Troubleshooting

### "No product detected"
- Ensure you're on `amazon.co.uk` (not .com or .de)
- URL must contain `/dp/ASIN10` format
- Reload the product page and try again

### "OpenRouter error 401"
- Check your API key in Settings
- Ensure your OpenRouter account has credits

### "Scraping failed"
- Amazon may have loaded the page with anti-bot measures
- Try refreshing the page and waiting a moment before exporting

### Images not downloading
- Some Amazon images require cookies — the extension uses your logged-in session
- Log into Amazon UK first for best results

---

## Architecture

```
manifest.json           ← MV3 config
background.js           ← Service worker (storage, downloads)
content.js              ← DOM scraper (injected into Amazon pages)
popup.html              ← Extension popup UI
popup.css               ← Dark industrial styles
popup.js                ← Main orchestration logic
src/services/
  ai/openrouter.js      ← AI API client
  excel/excelService.js ← Excel structure builder
  image/imageService.js ← Image fetcher
```

---

## Roadmap

- [ ] **v1.1**: Queue system (batch 50+ products)
- [ ] **v1.2**: eBay CSV export (Inkfrog/DSM Tool format)
- [ ] **v1.3**: Auto-upload to eBay via API
- [ ] **v2.0**: Amazon US/DE/FR support
- [ ] **v2.1**: Shopify product export
- [ ] **v3.0**: Etsy listing format

---

## License

MIT — Free to use, modify, distribute.
