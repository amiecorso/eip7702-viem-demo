"use client";

import { AnvilDemo } from "./components/AnvilDemo";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <a
            href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            EIP-7702
          </a>{" "}
          Demo
        </h1>
        <p className="text-xl text-gray-400 mb-8">
          Upgrade an EOA to a Smart Wallet on Local Anvil Chain
        </p>
      </div>

      <AnvilDemo />
    </main>
  );
}
