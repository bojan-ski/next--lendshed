import AvatarMenu from "@/components/auth/AvatarMenu";
import { getViewer } from "@/data/viewer";

// With no viewer it renders nothing: ViewerGate is already redirecting.
export default async function AvatarMenuSlot() {
  const viewer = await getViewer();
  return viewer ? <AvatarMenu viewer={viewer} /> : null;
}
