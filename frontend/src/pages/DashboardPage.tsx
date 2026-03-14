import { useEffect, useRef, useState, useCallback, useTransition } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import UserAvatar from "@/components/UserAvatar";
import { Plus, Users, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import PageTransition from "@/components/PageTransition";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, fadeUp } from "@/lib/animations";
import { useAuth } from "@/lib/AuthContext";
import {
  listMyGroups,
  createGroup,
  getGroup,
  type GroupSummary,
  type GroupMember,
} from "@/lib/api";

/* ── Group card with dynamic avatar count ── */
const AVATAR_SIZE = 40; // w-10
const AVATAR_OVERLAP = 8; // -space-x-2

function GroupCard({ group, members }: { group: GroupSummary; members: GroupMember[] }) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const [maxVisible, setMaxVisible] = useState(0);

  const recalc = useCallback(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.offsetWidth;
    if (width <= 0) return;
    // first avatar takes full size, each additional takes size - overlap
    const step = AVATAR_SIZE - AVATAR_OVERLAP;
    const fits = Math.max(0, Math.floor((width - AVATAR_SIZE) / step) + 1);
    // reserve one slot for the "+N" badge when we can't show all
    const need = members.length > fits ? fits - 1 : fits;
    setMaxVisible(Math.max(0, need));
  }, [members.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    recalc();
    return () => ro.disconnect();
  }, [recalc]);

  const visible = members.slice(0, maxVisible);
  const overflow = members.length - maxVisible;

  return (
    <motion.div variants={fadeUp}>
      <div
        onClick={() => startTransition(() => navigate(`/group/${group.id}`))}
        className="cursor-pointer"
      >
        <Card className={`transition-all hover:-translate-y-0.5 hover:shadow-md ${isPending ? "animate-pulse" : ""}`}>
          <div className="flex items-center gap-3 px-4 py-3">
            {/* Group name & count */}
            <div className="rounded-lg bg-secondary p-2 shrink-0">
              <Gamepad2 className="size-5 text-primary" />
            </div>
            <div className="text-left min-w-0 shrink-0">
              <CardTitle className="text-lg">{group.name}</CardTitle>
              <CardDescription>
                {group.member_count} member{group.member_count !== 1 ? "s" : ""}
              </CardDescription>
            </div>

            {/* Member avatars — fills remaining space */}
            <div ref={containerRef} className="flex-1 min-w-0 flex justify-end">
              <div className="flex -space-x-2">
              {visible.map((m) => (
                <UserAvatar key={m.user_id} name={m.name} imageUrl={m.image_url} className="h-10 w-10 shadow-sm shrink-0" fallbackClassName="text-[10px]" />
              ))}
              {overflow > 0 && (
                <Avatar className="h-10 w-10 shadow-sm shrink-0">
                  <AvatarFallback className="text-[10px]">
                    +{overflow}
                  </AvatarFallback>
                </Avatar>
              )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function DashboardPage() {
  const navigate = useNavigate();
  const [isProfilePending, startProfileTransition] = useTransition();
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupMembers, setGroupMembers] = useState<Record<string, GroupMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listMyGroups()
      .then(async (groups) => {
        setGroups(groups);
        // Fetch member previews in parallel
        const details = await Promise.allSettled(
          groups.map((g) => getGroup(g.id)),
        );
        const members: Record<string, GroupMember[]> = {};
        for (const result of details) {
          if (result.status === "fulfilled") {
            members[result.value.id] = result.value.members;
          }
        }
        setGroupMembers(members);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const group = await createGroup(newName.trim());
      setGroups((prev) => [...prev, group]);
      setNewName("");
      setShowCreate(false);
      navigate(`/group/${group.id}`);
    } catch {
      toast.error("Failed to create group. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8">
      {/* Header with profile avatar */}
      <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4">
        <div className="hidden sm:block flex-1" />
        <div className="text-center flex-1">
          <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Your game hub at a glance.</p>
        </div>
        <div className="flex-1 flex justify-center sm:justify-end">
          <div
            onClick={() => startProfileTransition(() => navigate('/profile'))}
            className="cursor-pointer"
          >
            <UserAvatar
              name={user?.name}
              imageUrl={user?.image_url}
              className={`h-20 w-20 border-2 border-border hover:border-primary transition-colors cursor-pointer ${isProfilePending ? "animate-pulse" : ""}`}
              fallbackClassName="text-sm"
            />
          </div>
        </div>
      </div>

      {/* My Group section */}
      <h2 className="text-xl font-semibold mb-4">My Groups</h2>

      {/* Group list */}
      {loading ? (
        <div className="flex flex-col gap-4 mb-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[71px] w-full rounded-2xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col items-center gap-4 py-8">
            <Users className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              You're not part of any group yet. Create one or ask for an invite link!
            </p>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          className="flex flex-col gap-4 mb-6"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              members={groupMembers[group.id] ?? []}
            />
          ))}
        </motion.div>
      )}

      {/* Create group — at the bottom */}
      {!loading && (showCreate ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 py-6">
            <Input
              placeholder="Group name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? "Creating…" : "Create Group"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex justify-center mb-6">
          <Button variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="size-4 mr-1" />
            Create a Group
          </Button>
        </div>
      ))}

    </PageTransition>
  );
}

export default DashboardPage;
