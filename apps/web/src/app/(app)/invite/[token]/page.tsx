"use client";

import { useParams } from "next/navigation";
import { InvitationCard } from "@/components/trip/InvitationCard";

/** /invite/:token — invite links and invite emails (spec §16). */
export default function InviteByTokenPage() {
  const { token } = useParams<{ token: string }>();
  return <InvitationCard by={{ token: decodeURIComponent(token) }} />;
}
