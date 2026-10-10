import type { Metadata } from "next";
import Lottery from "./lottery";

export const metadata: Metadata = {
  title: "抽獎小工具",
  description: "輸入名單、轉動轉盤，抽出幸運得主",
};

export default function LotteryPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-gradient-to-b from-rose-50 to-amber-50 px-4 py-10 text-zinc-900">
      <h1 className="mb-8 text-3xl font-bold tracking-tight">🎡 抽獎小工具</h1>
      <Lottery />
    </main>
  );
}
