"use client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TutorialPanel } from "../../tutorial-panel";
import "../../collection.css";
export default function DriverHelp() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <main className="collection-driver-route">
        <p className="eyebrow">COLLECTION DRIVER</p>
        <h1>Помощь водителю</h1>
        <TutorialPanel roles={["DRIVER"]} />
      </main>
    </QueryClientProvider>
  );
}
