import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { errors } from "@/strings/errors";

export default function RouteError({ retry }: { retry: () => void }) {
  return (
    <Notice tone="error">
      <div className="flex flex-col items-start gap-3">
        <p className="font-bold">{errors.somethingWentWrong}</p>
        <Button variant="outline" onClick={() => retry()}>
          {errors.tryAgain}
        </Button>
      </div>
    </Notice>
  );
}
