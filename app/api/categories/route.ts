import { NextResponse } from 'next/server';
import { getCategoryTree } from '@/lib/ct/categories';
import { getLocale } from '@/lib/session';

export async function GET() {
  try {
    const { locale } = await getLocale();
    const tree = await getCategoryTree(locale);

    // Flatten the tree to get all categories with their slugs
    const flattenCategories = (categories: typeof tree): Array<{ id: string; name: string; slug?: string }> => {
      const result: Array<{ id: string; name: string; slug?: string }> = [];
      for (const cat of categories) {
        result.push({ id: cat.id, name: cat.name, slug: cat.slug });
        if (cat.children) {
          result.push(...flattenCategories(cat.children));
        }
      }
      return result;
    };

    const allCategories = flattenCategories(tree);

    return NextResponse.json({ categories: allCategories });
  } catch (error) {
    console.error('Failed to fetch categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
