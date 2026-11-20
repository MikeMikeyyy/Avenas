// utils/connectFromGroup.ts
//
// A member's sheet's add, accept or connect (what it offers is
// utils/groupConnect.ts): the request, then what came of it, in words. Two
// trainers just connected are asked how to file each other
// (utils/connectionRolePrompt.ts) in place of "Connected", as accepting a
// request on the Connect screen does. Shared by the group's page and its
// member list, which each put the answer on their own roster
// (connectionAfter).

import { Alert } from "react-native";
import * as Haptics from "expo-haptics";

import { requestGroupConnection, type GroupConnectResult } from "../lib/groups";
import { askConnectionRole } from "./connectionRolePrompt";
import { alertMessage } from "./errors";
import { groupConnectOutcome } from "./groupConnect";
import type { AccountType } from "../contexts/AccountTypeContext";
import type { GroupMember } from "../constants/groups";

/** Ask `them` from the group, and say how it went. The server's answer, or
 *  null when it couldn't be asked (the alert has said why). */
export async function connectFromGroup(groupId: string, mine: AccountType, them: GroupMember): Promise<GroupConnectResult | null> {
  let result: GroupConnectResult;
  try {
    result = await requestGroupConnection(groupId, them.id);
  } catch (e) {
    Alert.alert("Couldn't send the request", alertMessage(e, "Check your connection and try again."));
    return null;
  }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  const said = groupConnectOutcome(result, mine, them.accountType, them.name);
  if (said) Alert.alert(said.title, said.body);
  else void askConnectionRole(them.id, them.name);
  return result;
}
