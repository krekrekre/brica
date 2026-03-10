import prisma from "@/lib/prisma";
import CalendarView from "./_components/CalendarView";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function KalendarPage() {
  const session = await getServerSession(authOptions);
  const [
    appointments,
    employees,
    schedules,
    irregularSchedules,
    timeOffs,
    users,
    services,
    settings,
  ] = await Promise.all([
    prisma.appointment.findMany({
      include: { user: true, employee: true, service: true },
    }),
    prisma.user.findMany({
      where: { role: "EMPLOYEE" },
      orderBy: { createdAt: "asc" },
    }),
    prisma.schedule.findMany(),
    prisma.irregularSchedule.findMany({ orderBy: { startDate: "asc" } }),
    prisma.timeOff.findMany(),
    prisma.user.findMany({
      where: { role: "USER" },
      orderBy: { name: "asc" },
    }),
    prisma.service.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.settings.findFirst(),
  ]);

  const calendarFieldDurationMinutes = settings?.appointmentDuration ?? 30;

  return (
    <div>
      <CalendarView
        appointments={appointments}
        employees={employees}
        schedules={schedules}
        irregularSchedules={irregularSchedules}
        timeOffs={timeOffs}
        users={users}
        services={services}
        defaultFieldDurationMinutes={calendarFieldDurationMinutes}
        currentUser={session?.user ? { id: session.user.id, role: session.user.role } : undefined}
      />
    </div>
  );
}
