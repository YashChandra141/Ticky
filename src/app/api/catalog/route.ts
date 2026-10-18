import { NextResponse } from "next/server";
import { getItemCatalog } from "@/lib/store";

export async function GET() {
  const catalog = await getItemCatalog();
  return NextResponse.json(catalog.map(({ description, unitPriceMinor }) => ({ description, unitPriceMinor })));
}
