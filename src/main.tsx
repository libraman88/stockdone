import React from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";
import App from "./App";
import UpdateBanner from "./UpdateBanner";
createRoot(document.getElementById("root")!).render(<React.StrictMode><><App/><UpdateBanner/></></React.StrictMode>);