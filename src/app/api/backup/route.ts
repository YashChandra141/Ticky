import { NextResponse } from "next/server";
import { backupDatabase, listDatabaseBackups } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listDatabaseBackups());
}

export async function POST() {
  const file = await backupDatabase();
  return NextResponse.json({ file: file.split(/[\\/]/).pop(), path: file }, { status: 201 });
}
