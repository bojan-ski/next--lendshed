import LoanGroup from "@/components/loans/LoanGroup";
import MyLoansTabs from "@/components/loans/MyLoansTabs";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { countNeedsAction, getMyLoans } from "@/data/my-loans";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { myLoansQuerySchema } from "@/lib/schemas/loans";
import { myLoans } from "@/strings/myLoans";
import type { LoanCardDTO } from "@/types/loan";

const GROUPS: LoanCardDTO["group"][] = ["needs_you", "active", "past"];

const EMPTY = {
  borrowing: { icon: "toolbox", href: "/" },
  lending: { icon: "box-open", href: "/my/items" },
} as const;

// No tab in the URL: land where the work is, Lending only when it alone
// needs the viewer (a badge click on an owner's pending request).
async function defaultTab(
  viewerId: string,
  today: string,
): Promise<LoanCardDTO["side"]> {
  const [borrowing, lending] = await Promise.all([
    countNeedsAction(viewerId, today, "borrowing"),
    countNeedsAction(viewerId, today, "lending"),
  ]);
  return borrowing === 0 && lending > 0 ? "lending" : "borrowing";
}

// Guards itself: the (app) layout doesn't re-run on a soft navigation.
export default async function MyLoansSection({
  searchParams,
}: Pick<PageProps<"/my/loans">, "searchParams">) {
  const viewer = await requireViewer();
  const today = requestToday();
  const query = myLoansQuerySchema.parse(await searchParams);
  const tab = query.tab ?? (await defaultTab(viewer.id, today));
  const loans = await getMyLoans(viewer.id, tab, today);
  const groups = GROUPS.filter((group) => loans[group].length > 0);

  return (
    <div className="flex flex-col gap-6">
      <MyLoansTabs tab={tab} />
      {groups.length === 0 ? (
        <EmptyState
          icon={EMPTY[tab].icon}
          heading={myLoans.empty[tab].heading}
          body={myLoans.empty[tab].body}
          action={
            <ButtonLink href={EMPTY[tab].href} className="max-sm:w-full">
              {myLoans.empty[tab].action}
            </ButtonLink>
          }
        />
      ) : (
        groups.map((group) => (
          <LoanGroup
            key={group}
            heading={myLoans.groups[group]}
            loans={loans[group]}
            today={today}
          />
        ))
      )}
    </div>
  );
}
