import type { Metadata } from "next";
import Pachinko from "./pachinko";

export const metadata: Metadata = {
  title: "打鴿台",
  description: "用尺打出彈珠，看它落進哪一排，贏得鴿子",
};

export default function PachinkoPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-gradient-to-b from-sky-50 to-amber-50 px-4 py-10 text-zinc-900">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">🕊️ 鴿子彈珠台</h1>
      <Pachinko />
    </main>
  );
}
