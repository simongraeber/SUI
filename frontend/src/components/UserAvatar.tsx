import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { resolveImageUrl } from "@/lib/api";

interface UserAvatarProps {
  name?: string | null;
  imageUrl?: string | null;
  className?: string;
  fallbackClassName?: string;
}

export default function UserAvatar({ name, imageUrl, className, fallbackClassName }: UserAvatarProps) {
  return (
    <Avatar className={className}>
      <AvatarImage src={resolveImageUrl(imageUrl) ?? undefined} alt={name ?? ""} />
      <AvatarFallback className={fallbackClassName}>
        {name?.charAt(0)?.toUpperCase() ?? "?"}
      </AvatarFallback>
    </Avatar>
  );
}
