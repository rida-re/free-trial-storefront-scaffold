import { NextRequest, NextResponse } from 'next/server';
import { getLocale } from '@/lib/session';
import { searchProducts } from '@/lib/ct/search';

// GET /api/products/search?q=keyword&limit=5
// Lightweight search endpoint for the voice assistant to find products by name.
export async function GET(req: NextRequest) {
  const { locale, currency, country } = await getLocale();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';
  const limit = Math.min(Number(searchParams.get('limit') ?? '5'), 10);

  if (!q.trim()) {
    return NextResponse.json({ products: [], total: 0 });
  }

  try {
    const results = await searchProducts({
      text: q.trim(),
      locale,
      currency,
      country,
      limit,
      withFacets: false,
    });

    // Return simplified product data (only what the voice tool needs)
    const simplified = results.products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      masterVariantId: p.variants[0]?.id ?? 1,
      sku: p.variants[0]?.sku ?? '',
      price: p.variants[0]?.price
        ? {
            centAmount: p.variants[0].price.centAmount,
            currencyCode: p.variants[0].price.currencyCode,
          }
        : null,
    }));

    return NextResponse.json({ products: simplified, total: results.total });
  } catch {
    return NextResponse.json({ products: [], total: 0 });
  }
}
