import { useAccountType } from "../../contexts/AccountTypeContext";
import PTHome from "../../components/trainer/PTHome";
import MyPTHome from "../../components/trainer/MyPTHome";

export default function TrainerHubScreen() {
  const { accountType } = useAccountType();
  return accountType === "pt" ? <PTHome /> : <MyPTHome />;
}
