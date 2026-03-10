"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";

async function checkAdmin() {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "ADMIN") {
        throw new Error("Unauthorized");
    }
}

export async function createEmployee(formData: FormData) {
    await checkAdmin();

    const name = formData.get("name") as string;
    const email = (formData.get("email") as string).trim().toLowerCase();
    const phone = (formData.get("phone") as string)?.trim() || null;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        throw new Error("Korisnik sa ovim email-om već postoji.");
    }

    // Employees do not log in; store a non-guessable placeholder hash
    const placeholderHash = await bcrypt.hash("employee-no-login-" + Math.random(), 10);
    await prisma.user.create({
        data: {
            name,
            email,
            passwordHash: placeholderHash,
            phone,
            role: "EMPLOYEE",
        },
    });

    revalidatePath("/admin/employees");
    redirect("/admin/employees");
}

export async function updateEmployee(id: string, formData: FormData): Promise<{ error?: string }> {
    await checkAdmin();

    const name = formData.get("name") as string;
    const email = (formData.get("email") as string).trim().toLowerCase();
    const phone = (formData.get("phone") as string)?.trim() || null;

    const employee = await prisma.user.findUnique({
        where: { id },
    });
    if (!employee || employee.role !== "EMPLOYEE") {
        return { error: "Zaposleni nije pronađen." };
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.id !== id) {
        return { error: "Korisnik sa ovim email-om već postoji." };
    }

    await prisma.user.update({
        where: { id },
        data: { name, email, phone },
    });

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${id}`);
    return {};
}

export async function deleteEmployee(id: string) {
    await checkAdmin();

    // Assuming cascading deletes or restricted deletes are handled in Prisma schema
    await prisma.user.delete({
        where: { id },
    });

    revalidatePath("/admin/employees");
}
