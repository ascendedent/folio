import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBeats } from "../src/fdx/beats.js";
import { readFdx } from "../src/fdx/read.js";
import { writeFdx } from "../src/fdx/write.js";
import { paragraphText } from "../src/model.js";
import { FolioError } from "../src/errors.js";
import { fixture } from "./helpers.js";

describe("FDX", () => {
  const script = readFdx(fixture("kitchen.fdx"));

  it("reads the title page, scenes, emphasis, notes, and dual dialogue", () => {
    assert.equal(script.version, "5");
    assert.equal(script.titlePage[0]?.text, "KITCHEN LETTER");
    assert.equal(script.titlePage[2]?.type, "Author");
    const heading = script.paragraphs.find((paragraph) => paragraph.kind === "scene-heading");
    assert.equal(paragraphText(heading!), "INT. KITCHEN - NIGHT");
    assert.equal(heading?.sceneNumber, "1");
    assert.equal(heading?.scene?.summary, "Maya finds the letter in the coat.");
    assert.deepEqual(heading?.scene?.arcCharacters, ["MAYA"]);
    const action = script.paragraphs.find((paragraph) => paragraph.kind === "action");
    assert.equal(action?.runs[1]?.text, "coat");
    assert.equal(action?.runs[1]?.bold, true);
    assert.deepEqual(action?.notes, ["Hold on the coat."]);
    const cues = script.paragraphs.filter((paragraph) => paragraph.kind === "character");
    assert.equal(cues[0]?.dualGroup, cues[1]?.dualGroup);
    assert.equal(paragraphText(cues[1]!), "JON");
    assert.equal(cues[2]?.dualGroup, undefined);
    assert.equal(paragraphText(cues[2]!), "MAYA (V.O.)");
  });

  it("lifts the beat board onto the script and reads its cards", () => {
    assert.equal(script.preserved.some((element) => element.name === "BeatBoard"), false);
    assert.equal(script.board?.cards.length, 2);
    assert.equal(script.board?.cards[0]?.id, "b1");
    assert.equal(script.board?.cards[0]?.x, 120);
    assert.equal(script.board?.cards[0]?.y, 40);
    assert.equal(script.board?.cards[0]?.color, "Gold");
    assert.equal(script.board?.cards[1]?.title, "Turn");
    assert.deepEqual(script.board?.links, [{ from: "b1", to: "b2" }]);
    const beats = extractBeats(script);
    const board = beats.filter((beat) => beat.source === "board");
    assert.deepEqual(
      board.map((beat) => beat.title),
      ["Opening", "Turn"],
    );
    assert.equal(board[0]?.body, "She burns the letter.");
    assert.equal(board[0]?.x, 120);
    assert.equal(board[0]?.y, 40);
    assert.equal(board[0]?.color, "Gold");
    assert.deepEqual(board[0]?.links, ["b2"]);
    assert.equal(beats.find((beat) => beat.source === "outline")?.title, "Act One");
    assert.equal(beats.find((beat) => beat.source === "outline")?.body, "She finds the letter.");
    assert.equal(beats.find((beat) => beat.source === "scene-card")?.body, "Maya finds the letter in the coat.");
    assert.equal(beats.find((beat) => beat.source === "character-arc")?.character, "MAYA");
  });

  it("round-trips the script and the preserved board", () => {
    const again = readFdx(writeFdx(script));
    assert.equal(again.titlePage[0]?.text, "KITCHEN LETTER");
    assert.deepEqual(
      again.paragraphs.map((paragraph) => [paragraph.fdxType, paragraphText(paragraph)]),
      script.paragraphs.map((paragraph) => [paragraph.fdxType, paragraphText(paragraph)]),
    );
    assert.equal(again.paragraphs.find((paragraph) => paragraph.kind === "action")?.runs[1]?.bold, true);
    assert.deepEqual(again.paragraphs.find((paragraph) => paragraph.notes.length)?.notes, ["Hold on the coat."]);
    const beats = extractBeats(again);
    assert.equal(beats.filter((beat) => beat.source === "board").length, 2);
    assert.equal(beats[0]?.links[0], "b2");
    assert.equal(again.board?.cards[0]?.x, 120);
    assert.equal(again.board?.cards[0]?.y, 40);
    assert.equal(again.board?.cards[0]?.color, "Gold");
    assert.equal(again.board?.cards[0]?.body, "She burns the letter.");
    assert.equal(again.board?.cards[1]?.id, "b2");
    assert.deepEqual(again.board?.links, [{ from: "b1", to: "b2" }]);
    const dual = again.paragraphs.filter((paragraph) => paragraph.kind === "character" && paragraph.dualGroup);
    assert.equal(dual.length, 2);
    assert.equal(dual[0]?.dualGroup, dual[1]?.dualGroup);
  });

  it("preserves an unknown paragraph type", () => {
    const custom = readFdx(`<?xml version="1.0"?>
      <FinalDraft DocumentType="Script" Version="5">
        <Content>
          <Paragraph Type="Super" Custom="yes"><Text>LATER</Text></Paragraph>
        </Content>
      </FinalDraft>`);
    assert.equal(custom.paragraphs[0]?.kind, "unknown");
    assert.equal(custom.paragraphs[0]?.attributes.Custom, "yes");
    const again = readFdx(writeFdx(custom));
    assert.equal(again.paragraphs[0]?.fdxType, "Super");
    assert.equal(again.paragraphs[0]?.attributes.Custom, "yes");
    assert.equal(paragraphText(again.paragraphs[0]!), "LATER");
  });

  it("reads a Final Draft beat board from DisplayBoard and ListItem", () => {
    const script = readFdx(`<?xml version="1.0"?>
      <FinalDraft DocumentType="Script" Version="5">
        <Content>
          <Paragraph Type="Action"><Text>A porch light flickers.</Text></Paragraph>
        </Content>
        <DisplayBoards>
          <DisplayBoard Type="Beat" Id="board-1" Height="10000" Width="24000" ZoomLevel="100.000" ScrollOrigin="0,0">
            <Item Id="card-1" Left="900" Top="20" Width="240" Height="140"/>
          </DisplayBoard>
          <DisplayBoard Type="StoryMap" Id="map-1" Height="76" Width="1000"/>
        </DisplayBoards>
        <ListItems>
          <ListItem Id="card-1" Type="Beat" Title="The porch" Color="#FFFFFFFFFFFF">
            <Content>
              <Paragraph>
                <Text Style="HiddenText">gone</Text>
                <Text>The porch light flickers twice.</Text>
              </Paragraph>
            </Content>
          </ListItem>
        </ListItems>
      </FinalDraft>`);
    assert.equal(script.board?.origin, "final-draft");
    assert.equal(script.board?.cards.length, 1);
    assert.equal(script.board?.cards[0]?.title, "The porch");
    assert.equal(script.board?.cards[0]?.body, "The porch light flickers twice.");
    assert.equal(script.board?.cards[0]?.x, 900);
    assert.equal(script.board?.cards[0]?.y, 20);
    assert.equal(script.preserved.some((element) => element.name === "DisplayBoards"), false);
    const again = readFdx(writeFdx(script));
    assert.equal(again.board?.origin, "final-draft");
    assert.equal(again.board?.cards[0]?.id, "card-1");
    assert.equal(again.board?.cards[0]?.x, 900);
    assert.equal(again.board?.cards[0]?.title, "The porch");
    assert.equal(again.board?.cards[0]?.body, "The porch light flickers twice.");
    assert.equal(again.board?.preserved.some((element) => element.name === "DisplayBoard"), true);
  });

  it("keeps a long hidden beat when the visible text is only a fragment, and grows the card", () => {
    const body = "The van idles at the curb while the crew waits for the street to clear and the light to change.";
    const script = readFdx(`<?xml version="1.0"?>
      <FinalDraft DocumentType="Script" Version="5">
        <Content>
          <Paragraph Type="Scene Heading"><Text>INT. VAN - NIGHT</Text></Paragraph>
          <Paragraph Type="Action"><Text>The van waits.</Text></Paragraph>
        </Content>
        <DisplayBoards>
          <DisplayBoard Type="Beat" Id="board-1" Height="10000" Width="24000">
            <Item Id="card-1" Left="10" Top="10" Width="240" Height="80"/>
          </DisplayBoard>
        </DisplayBoards>
        <ListItems>
          <ListItem Id="card-1" Type="Beat" Title="INT. VAN - NIGHT" Color="#FFFFFFFFFFFF">
            <Content>
              <Paragraph>
                <Text>c</Text>
                <Text Style="HiddenText">${body}</Text>
              </Paragraph>
            </Content>
          </ListItem>
        </ListItems>
      </FinalDraft>`);
    const card = script.board?.cards[0];
    assert.equal(card?.body, body);
    assert.ok((card?.height ?? 0) > 80);
    assert.equal(card?.sceneId, script.paragraphs[0]?.attributes.FolioId);
  });

  it("links several modules to one scene and keeps a manual link and an unlink", () => {
    const script = readFdx(`<?xml version="1.0"?>
      <FinalDraft DocumentType="Script" Version="5">
        <Content>
          <Paragraph Type="Scene Heading" FolioId="sc-kitchen"><Text>INT. KITCHEN - NIGHT</Text></Paragraph>
          <Paragraph Type="Action"><Text>She waits.</Text></Paragraph>
          <Paragraph Type="Scene Heading" FolioId="sc-street"><Text>EXT. STREET - NIGHT</Text></Paragraph>
          <Paragraph Type="Action"><Text>She runs.</Text></Paragraph>
        </Content>
        <DisplayBoards>
          <DisplayBoard Type="Beat" Id="board-1" Height="10000" Width="24000">
            <Item Id="kitchen-a" Left="0" Top="0" Width="220" Height="120"/>
            <Item Id="pocket" Left="280" Top="0" Width="220" Height="120"/>
            <Item Id="loose" Left="560" Top="0" Width="220" Height="120"/>
            <Item Id="pinned" Left="840" Top="0" Width="220" Height="120"/>
          </DisplayBoard>
        </DisplayBoards>
        <ListItems>
          <ListItem Id="kitchen-a" Type="Beat" Title="INT. KITCHEN - NIGHT" Color="#FFFFFFFFFFFF">
            <Content><Paragraph><Text>She finds the letter.</Text></Paragraph></Content>
          </ListItem>
          <ListItem Id="pocket" Type="Beat" Title="The coat pocket" Color="#FFFFFFFFFFFF">
            <Content><Paragraph><Text>A second module.</Text></Paragraph></Content>
          </ListItem>
          <ListItem Id="loose" Type="Beat" Title="INT. KITCHEN - NIGHT" FolioScene="" Color="#FFFFFFFFFFFF">
            <Content><Paragraph><Text>Left unlinked.</Text></Paragraph></Content>
          </ListItem>
          <ListItem Id="pinned" Type="Beat" Title="INT. KITCHEN - NIGHT" FolioScene="sc-street" Color="#FFFFFFFFFFFF">
            <Content><Paragraph><Text>Pinned to the street.</Text></Paragraph></Content>
          </ListItem>
        </ListItems>
      </FinalDraft>`);
    const byId = new Map((script.board?.cards ?? []).map((card) => [card.id, card]));
    assert.equal(byId.get("kitchen-a")?.sceneId, "sc-kitchen");
    assert.equal(byId.get("pocket")?.sceneId, undefined);
    assert.equal(byId.get("loose")?.sceneId, "");
    assert.equal(byId.get("pinned")?.sceneId, "sc-street");
    const again = readFdx(writeFdx(script));
    const round = new Map((again.board?.cards ?? []).map((card) => [card.id, card]));
    assert.equal(round.get("kitchen-a")?.sceneId, "sc-kitchen");
    assert.equal(round.get("loose")?.sceneId, "");
    assert.equal(round.get("pinned")?.sceneId, "sc-street");
    assert.equal(again.board?.origin, "final-draft");
  });

  it("rejects a file that is not Final Draft XML", () => {
    assert.throws(() => readFdx("<html></html>"), FolioError);
    assert.throws(() => readFdx("<FinalDraft></FinalDraft>"), FolioError);
  });
});
