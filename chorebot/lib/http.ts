import { NextResponse } from "next/server";
import { localDay } from "@/lib/schedule";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const parseDay = (value: unknown) =>
  typeof value === "string" && DAY.test(value) ? value : localDay();

export const fail = (message: string, status = 500) =>
  NextResponse.json({ success: false, error: message }, { status });
