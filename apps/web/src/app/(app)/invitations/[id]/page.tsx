"use client";

import { useParams } from "next/navigation";
import { InvitationCard } from "@/components/trip/InvitationCard";

/** /invitations/:id — opened from an in-app notification; bound to the invitee's email. */
export default function InvitationByIdPage() {
  const { id } = useParams<{ id: string }>();
  return <InvitationCard by={{ id }} />;
}
