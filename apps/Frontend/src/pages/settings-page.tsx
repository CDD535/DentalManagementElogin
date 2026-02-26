import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { StaffTable } from "@/components/staffs/staff-table";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { StaffForm } from "@/components/staffs/staff-form";
import { DeleteConfirmationDialog } from "@/components/ui/deleteDialog";
import { CredentialTable } from "@/components/settings/insuranceCredTable";
import { useAuth } from "@/hooks/use-auth";
import { Staff } from "@repo/db/types";

type SafeUser = { id: number; username: string; role: "ADMIN" | "USER" };

export default function SettingsPage() {
  const { toast } = useToast();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [credentialModalOpen, setCredentialModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  const toggleMobileMenu = () => setIsMobileMenuOpen((prev) => !prev);

  const {
    data: staff = [],
    isLoading,
    isError,
    error,
  } = useQuery<Staff[]>({
    queryKey: ["/api/staffs/"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/staffs/");
      if (!res.ok) {
        throw new Error("Failed to fetch staff");
      }
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const addStaffMutate = useMutation<
    Staff,
    Error,
    Omit<Staff, "id" | "createdAt">
  >({
    mutationFn: async (newStaff: Omit<Staff, "id" | "createdAt">) => {
      const res = await apiRequest("POST", "/api/staffs/", newStaff);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message || "Failed to add staff");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staffs/"] });
      toast({
        title: "Staff Added",
        description: "Staff member added successfully.",
        variant: "default",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to add staff",
        variant: "destructive",
      });
    },
  });

  const updateStaffMutate = useMutation<
    Staff,
    Error,
    { id: number; updatedFields: Partial<Staff> }
  >({
    mutationFn: async ({
      id,
      updatedFields,
    }: {
      id: number;
      updatedFields: Partial<Staff>;
    }) => {
      const res = await apiRequest("PUT", `/api/staffs/${id}`, updatedFields);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message || "Failed to update staff");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staffs/"] });
      toast({
        title: "Staff Updated",
        description: "Staff member updated successfully.",
        variant: "default",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to update staff",
        variant: "destructive",
      });
    },
  });

  const deleteStaffMutation = useMutation<number, Error, number>({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/staffs/${id}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message || "Failed to delete staff");
      }
      return id;
    },
    onSuccess: () => {
      setIsDeleteStaffOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/staffs/"] });
      toast({
        title: "Staff Removed",
        description: "Staff member deleted.",
        variant: "default",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to delete staff",
        variant: "destructive",
      });
    },
  });

  const isAdding = addStaffMutate.status === "pending";
  const isAddSuccess = addStaffMutate.status === "success";

  const isUpdating = updateStaffMutate.status === "pending";
  const isUpdateSuccess = updateStaffMutate.status === "success";

  const openAddStaffModal = () => {
    setEditingStaff(null);
    setModalOpen(true);
  };

  const openEditStaffModal = (staff: Staff) => {
    setEditingStaff(staff);
    setModalOpen(true);
  };

  const handleFormSubmit = (formData: Omit<Staff, "id" | "createdAt">) => {
    if (editingStaff) {
      if (editingStaff.id === undefined) {
        toast({
          title: "Error",
          description: "Staff ID is missing",
          variant: "destructive",
        });
        return;
      }
      updateStaffMutate.mutate({
        id: editingStaff.id,
        updatedFields: formData,
      });
    } else {
      addStaffMutate.mutate(formData);
    }
  };

  const handleModalCancel = () => {
    setModalOpen(false);
  };

  useEffect(() => {
    if (isAddSuccess || isUpdateSuccess) {
      setModalOpen(false);
    }
  }, [isAddSuccess, isUpdateSuccess]);

  const [isDeleteStaffOpen, setIsDeleteStaffOpen] = useState(false);
  const [currentStaff, setCurrentStaff] = useState<Staff | undefined>(
    undefined
  );

  const handleDeleteStaff = (staff: Staff) => {
    setCurrentStaff(staff);
    setIsDeleteStaffOpen(true);
  };

  const handleConfirmDeleteStaff = async () => {
    if (currentStaff?.id) {
      deleteStaffMutation.mutate(currentStaff.id);
    } else {
      toast({
        title: "Error",
        description: "No Staff selected for deletion.",
        variant: "destructive",
      });
    }
  };

  const handleViewStaff = (staff: Staff) =>
    alert(
      `Viewing staff member:\n${staff.name} (${staff.email || "No email"})`
    );

  // --- Users control (list, add, edit password, delete) ---
  const {
    data: usersList = [],
    isLoading: usersLoading,
    isError: usersError,
    error: usersErrorObj,
  } = useQuery<SafeUser[]>({
    queryKey: ["/api/users/list"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/list");
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    staleTime: 1000 * 60 * 2,
  });

  const addUserMutate = useMutation<SafeUser, Error, { username: string; password: string; role?: "ADMIN" | "USER" }>({
    mutationFn: async (data) => {
      const res = await apiRequest("POST", "/api/users/", data);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to add user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/list"] });
      setAddUserModalOpen(false);
      toast({ title: "User Added", description: "User created successfully.", variant: "default" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e?.message || "Failed to add user", variant: "destructive" });
    },
  });

  const updateUserPasswordMutate = useMutation<SafeUser, Error, { id: number; password: string }>({
    mutationFn: async ({ id, password }) => {
      const res = await apiRequest("PUT", `/api/users/${id}`, { password });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to update password");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/list"] });
      setEditPasswordUser(null);
      toast({ title: "Password Updated", description: "Password changed successfully.", variant: "default" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e?.message || "Failed to update password", variant: "destructive" });
    },
  });

  const deleteUserMutate = useMutation<number, Error, number>({
    mutationFn: async (id) => {
      const res = await apiRequest("DELETE", `/api/users/${id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to delete user");
      }
      return id;
    },
    onSuccess: () => {
      setUserToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/users/list"] });
      toast({ title: "User Removed", description: "User deleted.", variant: "default" });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e?.message || "Failed to delete user", variant: "destructive" });
    },
  });

  const [addUserModalOpen, setAddUserModalOpen] = useState(false);
  const [editPasswordUser, setEditPasswordUser] = useState<SafeUser | null>(null);
  const [userToDelete, setUserToDelete] = useState<SafeUser | null>(null);

  // MANAGE USER (current user profile)
  const [usernameUser, setUsernameUser] = useState("");

  const { user } = useAuth();
  useEffect(() => {
    if (user?.username) {
      setUsernameUser(user.username);
    }
  }, [user]);

  const updateUserMutate = useMutation({
    mutationFn: async (
      updates: Partial<{ username: string; password: string }>
    ) => {
      if (!user?.id) throw new Error("User not loaded");
      const res = await apiRequest("PUT", `/api/users/${user.id}`, updates);
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/"] });
      toast({
        title: "Updated",
        description: "Your profile has been updated.",
        variant: "default",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err?.message || "Failed to update user",
        variant: "destructive",
      });
    },
  });

  return (
    <div>
          <Card>
            <CardContent>
              <div className="mt-8">
                <StaffTable
                  staff={staff}
                  isLoading={isLoading}
                  isError={isError}
                  onAdd={openAddStaffModal}
                  onEdit={openEditStaffModal}
                  onDelete={handleDeleteStaff}
                  onView={handleViewStaff}
                />
                {isError && (
                  <p className="mt-4 text-red-600">
                    {(error as Error)?.message || "Failed to load staff data."}
                  </p>
                )}

                <DeleteConfirmationDialog
                  isOpen={isDeleteStaffOpen}
                  onConfirm={handleConfirmDeleteStaff}
                  onCancel={() => setIsDeleteStaffOpen(false)}
                  entityName={currentStaff?.name}
                />
              </div>
            </CardContent>
          </Card>

          {/* Modal Overlay */}
          {modalOpen && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
              <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
                <h2 className="text-lg font-bold mb-4">
                  {editingStaff ? "Edit Staff" : "Add Staff"}
                </h2>
                <StaffForm
                  initialData={editingStaff || undefined}
                  onSubmit={handleFormSubmit}
                  onCancel={handleModalCancel}
                  isLoading={isAdding || isUpdating}
                />
              </div>
            </div>
          )}

          {/* Users control section */}
          <Card className="mt-6">
            <CardContent className="py-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">User Accounts</h3>
                <button
                  type="button"
                  onClick={() => setAddUserModalOpen(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Add User
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {usersLoading && (
                      <tr><td colSpan={3} className="px-4 py-4 text-gray-500">Loading users...</td></tr>
                    )}
                    {usersError && (
                      <tr><td colSpan={3} className="px-4 py-4 text-red-600">{(usersErrorObj as Error)?.message}</td></tr>
                    )}
                    {!usersLoading && !usersError && usersList.filter((u) => u.id !== user?.id).length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-4 text-gray-500">No other users.</td></tr>
                    )}
                    {!usersLoading && usersList.filter((u) => u.id !== user?.id).map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-2">
                          <span>{u.username}</span>
                        </td>
                        <td className="px-4 py-2">{u.role}</td>
                        <td className="px-4 py-2 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => setEditPasswordUser(u)}
                            className="text-blue-600 hover:underline"
                          >
                            Edit password
                          </button>
                          <button
                            type="button"
                            onClick={() => setUserToDelete(u)}
                            className="text-red-600 hover:underline"
                            title="Delete user"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* User Setting section (current user profile) */}
          <Card className="mt-6">
            <CardContent className="space-y-4 py-6">
              <h3 className="text-lg font-semibold">Admin Setting</h3>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const password =
                    formData.get("password")?.toString().trim() || undefined;

                  updateUserMutate.mutate({
                    username: usernameUser?.trim() || undefined,
                    password: password || undefined,
                  });
                }}
              >
                <div>
                  <label className="block text-sm font-medium">Username</label>
                  <input
                    type="text"
                    name="username"
                    value={usernameUser}
                    onChange={(e) => setUsernameUser(e.target.value)}
                    className="mt-1 p-2 border rounded w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium">
                    New Password
                  </label>
                  <input
                    type="password"
                    name="password"
                    className="mt-1 p-2 border rounded w-full"
                    placeholder="••••••••"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Leave blank to keep current password.
                  </p>
                </div>

                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                  disabled={updateUserMutate.isPending}
                >
                  {updateUserMutate.isPending ? "Saving..." : "Save Changes"}
                </button>
              </form>
            </CardContent>
          </Card>

          {/* Add User modal */}
          {addUserModalOpen && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
              <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
                <h2 className="text-lg font-bold mb-4">Add User</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const username = (form.querySelector('[name="new-username"]') as HTMLInputElement)?.value?.trim();
                    const password = (form.querySelector('[name="new-password"]') as HTMLInputElement)?.value;
                    const role = (form.querySelector('[name="new-role"]') as HTMLSelectElement)?.value as "ADMIN" | "USER";
                    if (!username || !password) {
                      toast({ title: "Error", description: "Username and password are required.", variant: "destructive" });
                      return;
                    }
                    addUserMutate.mutate({ username, password, role: role || "USER" });
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium">Username</label>
                    <input name="new-username" type="text" required className="mt-1 p-2 border rounded w-full" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Password</label>
                    <input name="new-password" type="password" required className="mt-1 p-2 border rounded w-full" placeholder="••••••••" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Role</label>
                    <select name="new-role" className="mt-1 p-2 border rounded w-full" defaultValue="USER">
                      <option value="USER">User</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setAddUserModalOpen(false)} className="px-4 py-2 border rounded hover:bg-gray-100">
                      Cancel
                    </button>
                    <button type="submit" disabled={addUserMutate.isPending} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                      {addUserMutate.isPending ? "Adding..." : "Add User"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Edit password modal */}
          {editPasswordUser && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
              <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
                <h2 className="text-lg font-bold mb-4">Change password for {editPasswordUser.username}</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const password = (form.querySelector('[name="edit-password"]') as HTMLInputElement)?.value;
                    if (!password?.trim()) {
                      toast({ title: "Error", description: "Password is required.", variant: "destructive" });
                      return;
                    }
                    updateUserPasswordMutate.mutate({ id: editPasswordUser.id, password });
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium">New password</label>
                    <input name="edit-password" type="password" required className="mt-1 p-2 border rounded w-full" placeholder="••••••••" />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setEditPasswordUser(null)} className="px-4 py-2 border rounded hover:bg-gray-100">
                      Cancel
                    </button>
                    <button type="submit" disabled={updateUserPasswordMutate.isPending} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                      {updateUserPasswordMutate.isPending ? "Saving..." : "Save"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <DeleteConfirmationDialog
            isOpen={!!userToDelete}
            onConfirm={() => userToDelete && deleteUserMutate.mutate(userToDelete.id)}
            onCancel={() => setUserToDelete(null)}
            entityName={userToDelete?.username}
          />

          {/* Credential Section */}
          <div className="mt-6">
            <CredentialTable />
          </div>
    </div>
  );
}
